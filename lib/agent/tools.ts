// Call-agent tools. They run in the browser against the fleet engine and
// return at once: a delivery takes minutes, so arrival is never a tool result.
import type { ToolDef } from '../meta/client.ts';
import { ROOMS } from '../hotel.ts';
import type { LineItem } from '../fleet/types.ts';

export type TaskView = {
  task_id: string;
  status: string;
  room: string;
  item: string;
  qty: number;
  also?: LineItem[];
  eta_seconds: number;
  robot: string | null;
};

// Sync in the engine itself, async through the sim worker; tools await either.
type MaybeAsync<T> = T | Promise<T>;
export type FleetApi = {
  createTask(i: { item: string; qty: number; also?: LineItem[]; room: string; callId: string }): MaybeAsync<{ task_id: string; eta_seconds: number }>;
  getTask(id: string): MaybeAsync<TaskView | null>;
  cancelTask(id: string): MaybeAsync<boolean>;
};

export type ToolContext = { callId: string; items: string[]; escalate?: (reason: string, room?: string) => unknown; room?: string };

const MAX_QTY = 5;
const MAX_LINES = 3; // what fits one cabin

const singular = (s: string) => s.split(' ').map((w) => (w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');

// Guests say "towels" or "a pillow"; inventory says "towel" and "extra
// pillow". Several partial matches come back as candidates so the agent asks.
export function matchItem(raw: string, items: string[]): { item: string } | { candidates: string[] } {
  const q = raw.toLowerCase().trim();
  for (const form of [q, singular(q)]) if (items.includes(form)) return { item: form };
  const hits = items.filter((name) => name.includes(singular(q)) || q.includes(name));
  return hits.length === 1 ? { item: hits[0] } : { candidates: hits };
}

export async function runTool(name: string, args: unknown, fleet: FleetApi, ctx: ToolContext): Promise<object> {
  const a = (args ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'create_task': {
      const room = String(a.room ?? ctx.room ?? '').trim();
      if (!ROOMS.includes(room)) return { error: `room "${room}" does not exist; rooms are ${ROOMS.join(', ')}. Ask the guest again.` };
      const wanted = [{ item: a.item, qty: a.qty }, ...(Array.isArray(a.also) ? a.also : [])].slice(0, MAX_LINES) as { item?: unknown; qty?: unknown }[];
      const lines: LineItem[] = [];
      for (const w of wanted) {
        const m = matchItem(String(w.item ?? ''), ctx.items);
        if (!('item' in m)) {
          return m.candidates.length
            ? { error: `"${w.item}" could mean ${m.candidates.join(' or ')}; ask which.` }
            : { error: `"${w.item}" is not something we deliver.` };
        }
        const line = { item: m.item, qty: Math.min(MAX_QTY, Math.max(1, Math.round(Number(w.qty) || 1))) };
        if (!lines.some((l) => l.item === line.item)) lines.push(line);
      }
      const [first, ...also] = lines;
      const t = await fleet.createTask({ ...first, ...(also.length ? { also } : {}), room, callId: ctx.callId });
      return { ...t, ...first, ...(also.length ? { also } : {}), room };
    }
    case 'get_task_status':
      return (await fleet.getTask(String(a.task_id))) ?? { error: `no task ${a.task_id}` };
    case 'cancel_task':
      return (await fleet.cancelTask(String(a.task_id))) ? { cancelled: true } : { error: `cannot cancel ${a.task_id}` };
    case 'escalate_to_frontdesk':
      await ctx.escalate?.(String(a.reason ?? 'Guest asked for the front desk'), a.room ? String(a.room) : ctx.room);
      return { ack: true };
    case 'end_call':
      return { ended: true };
    default:
      return { error: `unknown tool ${name}` };
  }
}

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const TOOL_DEFS: ToolDef[] = [
  fn('create_task', 'Send a delivery robot with an item to a guest room.', {
    item: { type: 'string', description: 'Item name from the inventory list' },
    qty: { type: 'integer', minimum: 1, maximum: MAX_QTY },
    also: {
      type: 'array',
      description: 'Other items for the same room; they ride in the same cabin',
      items: { type: 'object', properties: { item: { type: 'string' }, qty: { type: 'integer', minimum: 1, maximum: MAX_QTY } }, required: ['item', 'qty'] },
    },
    room: { type: 'string', description: 'Room number as digits, e.g. "804". Leave out for the room the call is coming from.' },
  }, ['item', 'qty']),
  fn('get_task_status', 'Current status and ETA of a delivery.', { task_id: { type: 'string' } }, ['task_id']),
  fn('cancel_task', 'Cancel a delivery the guest no longer wants.', { task_id: { type: 'string' } }, ['task_id']),
  fn('escalate_to_frontdesk', 'Pass something the robots cannot do to the front desk staff: late checkout, complaints, billing, or a guest asking for a person.', {
    reason: { type: 'string', description: 'What the guest needs, in one short sentence' },
    room: { type: 'string', description: 'Room number as digits, if known' },
  }, ['reason']),
  fn('end_call', 'Hang up after the guest has their confirmation and ETA, or says goodbye.'),
];
