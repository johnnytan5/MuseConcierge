// Call-agent tools. They run in the browser against the fleet engine and
// return at once: a delivery takes minutes, so arrival is never a tool result.
import type { ToolDef } from '../meta/client.ts';
import { ROOMS } from '../hotel.ts';

export type TaskView = {
  task_id: string;
  status: string;
  room: string;
  item: string;
  qty: number;
  eta_seconds: number;
  robot: string | null;
};

// Sync in the engine itself, async through the sim worker; tools await either.
type MaybeAsync<T> = T | Promise<T>;
export type FleetApi = {
  createTask(i: { item: string; qty: number; room: string; callId: string }): MaybeAsync<{ task_id: string; eta_seconds: number }>;
  getTask(id: string): MaybeAsync<TaskView | null>;
  cancelTask(id: string): MaybeAsync<boolean>;
};

export type ToolContext = { callId: string; items: string[] };

const MAX_QTY = 5;

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
      const room = String(a.room ?? '').trim();
      if (!ROOMS.includes(room)) return { error: `room "${room}" does not exist; rooms are ${ROOMS.join(', ')}. Ask the guest again.` };
      const m = matchItem(String(a.item ?? ''), ctx.items);
      if (!('item' in m)) {
        return m.candidates.length
          ? { error: `"${a.item}" could mean ${m.candidates.join(' or ')}; ask which.` }
          : { error: `"${a.item}" is not something we deliver.` };
      }
      const qty = Math.min(MAX_QTY, Math.max(1, Math.round(Number(a.qty) || 1)));
      const t = await fleet.createTask({ item: m.item, qty, room, callId: ctx.callId });
      return { ...t, item: m.item, qty, room };
    }
    case 'get_task_status':
      return (await fleet.getTask(String(a.task_id))) ?? { error: `no task ${a.task_id}` };
    case 'cancel_task':
      return (await fleet.cancelTask(String(a.task_id))) ? { cancelled: true } : { error: `cannot cancel ${a.task_id}` };
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
  fn('create_task', 'Send a delivery robot with an item to a guest room. Call only after the guest confirmed the room number.', {
    item: { type: 'string', description: 'Item name from the inventory list' },
    qty: { type: 'integer', minimum: 1, maximum: MAX_QTY },
    room: { type: 'string', description: 'Room number as digits, e.g. "804"' },
  }, ['item', 'qty', 'room']),
  fn('get_task_status', 'Current status and ETA of a delivery.', { task_id: { type: 'string' } }, ['task_id']),
  fn('cancel_task', 'Cancel a delivery the guest no longer wants.', { task_id: { type: 'string' } }, ['task_id']),
  fn('end_call', 'Hang up after the guest has their confirmation and ETA, or says goodbye.'),
];
