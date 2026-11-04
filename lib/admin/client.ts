// Page side of the hotel's records. Log lines go one at a time, so a call's
// record stays in the order things happened; a failed write never disturbs it.
export type LogLine =
  | { turn: { role: 'guest' | 'agent'; text: string } }
  | { tool: { name: string; args?: unknown; result?: unknown; summary?: string } }
  | { end?: boolean; room?: string };

let queue: Promise<unknown> = Promise.resolve();

const post = (url: string, body: object, method = 'POST') =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function logCall(callId: string | null, line: LogLine): Promise<unknown> {
  if (!callId) return queue;
  queue = queue.then(() => post('/api/call/log', { callId, ...line })).catch(() => {});
  return queue;
}

export function escalate(callId: string | null, reason: string, room?: string): Promise<unknown> {
  return post('/api/escalations', { callId, reason, room }).catch(() => {});
}

export function deductStock(callId: string, taskId: string, lines: { item: string; qty: number }[]): Promise<unknown> {
  return post('/api/stock', { callId, taskId, lines }).catch(() => {});
}

export async function setEscalation(id: string, status: 'open' | 'resolved', callId: string | null): Promise<string | null> {
  const res = await post('/api/escalations', { id, status, callId }, 'PATCH');
  if (res.ok) return null;
  return (await res.json().catch(() => ({}))).error ?? 'Could not save';
}
