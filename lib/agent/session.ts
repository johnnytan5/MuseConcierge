// One phone call: guest transcripts in, spoken replies out. The browser keeps
// the history and runs tools locally; /api/agent does the Muse Spark turn.
import type { ChatMessage, AssistantMessage } from '../meta/client.ts';
import { runTool, type FleetApi } from './tools.ts';

const MAX_TOOL_ROUNDS = 4; // stops a model that keeps calling tools from looping
const ANYTHING_ELSE = 'Is there anything else I can help with?';
const GOODBYE = 'Thank you, have a nice stay.';
const NOTHING_ELSE = /\b(no|nope|nothing|that'?s (all|it)|thanks|thank you|bye|goodbye)\b/i;

export type CallLog =
  | { kind: 'guest'; text: string }
  | { kind: 'agent'; text: string; ms: number }
  | { kind: 'tool'; name: string; args: unknown; result: object; ms: number }
  | { kind: 'error'; text: string };

export class CallSession {
  callId: string;
  fleet: FleetApi;
  items: string[];
  onSay: (text: string) => Promise<void>;
  onEnd: () => void;
  onLog: (entry: CallLog) => void;
  agentUrl: string;
  messages: ChatMessage[] = [];
  ended = false;
  queue: Promise<void> = Promise.resolve();
  speech: Promise<void> = Promise.resolve();
  closing = false; // a request is done, so the guest may be wrapping up
  room?: string;
  escalate?: (reason: string, room?: string) => unknown;

  constructor(callId: string, fleet: FleetApi, items: string[], hooks: {
    onSay: (text: string) => Promise<void>;
    onEnd: () => void;
    onLog?: (entry: CallLog) => void;
    room?: string; // the room the call is coming from
    escalate?: (reason: string, room?: string) => unknown;
    agentUrl?: string; // absolute URL when run outside the page, e.g. scripts/call-check.mts
  }) {
    this.callId = callId;
    this.fleet = fleet;
    this.items = items;
    this.onSay = hooks.onSay;
    this.onEnd = hooks.onEnd;
    this.onLog = hooks.onLog ?? (() => {});
    this.escalate = hooks.escalate;
    this.room = hooks.room;
    this.agentUrl = hooks.agentUrl ?? '/api/agent';
  }

  // Turns run one at a time, in order, even if the guest speaks again while
  // the agent is still thinking.
  onGuest(text: string): Promise<void> {
    this.queue = this.queue.then(() => this.turn(text)).catch((e) => {
      this.onLog({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    });
    return this.queue;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.onEnd();
  }

  async turn(text: string): Promise<void> {
    if (this.ended) return;
    this.onLog({ kind: 'guest', text });
    this.messages.push({ role: 'user', content: text });
    let hangUp = false;
    let done = false; // this turn placed an order or reached the front desk
    let spoke = false;
    let asked = false;
    let usedTool = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { message, ms } = await this.complete();
      this.messages.push(message);
      // Spark's own goodbye tends to announce the hang-up, so the last line is fixed.
      const hangingUp = !done && message.tool_calls?.some((c) => c.function.name === 'end_call');
      const line = hangingUp ? undefined : message.content?.trim();
      if (line) {
        this.say(line, ms);
        spoke = true;
        asked = line.includes('?');
      }
      if (!message.tool_calls?.length) {
        // Spark often says goodbye and stops without calling end_call.
        hangUp = this.closing && !usedTool && !asked && !!line && NOTHING_ELSE.test(text);
        break;
      }
      let heldOpen = false;
      for (const call of message.tool_calls) {
        // The guest hasn't been asked yet whether they need anything else.
        if (call.function.name === 'end_call' && done) {
          this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ended: false }) });
          heldOpen = true;
          continue;
        }
        usedTool = true;
        let args: unknown = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* the tool reports bad args */ }
        const result = await runTool(call.function.name, args, this.fleet, { callId: this.callId, items: this.items, escalate: this.escalate, room: this.room });
        this.onLog({ kind: 'tool', name: call.function.name, args, result, ms });
        this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        if (call.function.name === 'end_call') hangUp = true;
        if ((call.function.name === 'create_task' || call.function.name === 'escalate_to_frontdesk') && !('error' in result)) done = true;
      }
      if (hangUp || (heldOpen && spoke)) break;
    }
    if (done) this.closing = true;
    if (done && !asked && !hangUp) this.closeWith(ANYTHING_ELSE);
    if (hangUp && !spoke) this.closeWith(GOODBYE);
    await this.speech;
    if (hangUp) this.end();
  }

  // Speech is queued, not awaited: tools and the next model call run while
  // the agent is still talking.
  say(line: string, ms: number): void {
    this.onLog({ kind: 'agent', text: line, ms });
    this.speech = this.speech.then(() => this.onSay(line));
  }

  closeWith(line: string): void {
    this.messages.push({ role: 'assistant', content: line });
    this.say(line, 0);
  }

  async complete(): Promise<{ message: AssistantMessage; ms: number }> {
    const res = await fetch(this.agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: this.messages, callId: this.callId, room: this.room }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `agent ${res.status}`);
    return body;
  }
}
