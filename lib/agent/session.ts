// One phone call: guest transcripts in, spoken replies out. The browser keeps
// the history and runs tools locally; /api/agent does the Muse Spark turn.
import type { ChatMessage, AssistantMessage } from '../meta/client.ts';
import { runTool, type FleetApi } from './tools.ts';

const MAX_TOOL_ROUNDS = 4; // stops a model that keeps calling tools from looping

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

  constructor(callId: string, fleet: FleetApi, items: string[], hooks: {
    onSay: (text: string) => Promise<void>;
    onEnd: () => void;
    onLog?: (entry: CallLog) => void;
    agentUrl?: string; // absolute URL when run outside the page, e.g. scripts/call-check.mts
  }) {
    this.callId = callId;
    this.fleet = fleet;
    this.items = items;
    this.onSay = hooks.onSay;
    this.onEnd = hooks.onEnd;
    this.onLog = hooks.onLog ?? (() => {});
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

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { message, ms } = await this.complete();
      this.messages.push(message);
      if (message.content?.trim()) {
        const line = message.content.trim();
        this.onLog({ kind: 'agent', text: line, ms });
        // Speech is queued, not awaited: tools and the next model call run
        // while the agent is still talking.
        this.speech = this.speech.then(() => this.onSay(line));
      }
      if (!message.tool_calls?.length) break;
      for (const call of message.tool_calls) {
        let args: unknown = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* the tool reports bad args */ }
        const result = await runTool(call.function.name, args, this.fleet, { callId: this.callId, items: this.items });
        this.onLog({ kind: 'tool', name: call.function.name, args, result, ms });
        this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        if (call.function.name === 'end_call') hangUp = true;
      }
      if (hangUp) break;
    }
    await this.speech;
    if (hangUp) this.end();
  }

  async complete(): Promise<{ message: AssistantMessage; ms: number }> {
    const res = await fetch(this.agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: this.messages, callId: this.callId }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `agent ${res.status}`);
    return body;
  }
}
