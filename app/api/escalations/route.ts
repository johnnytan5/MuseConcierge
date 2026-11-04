// Things the assistant can't handle land with the front desk.
import { clip, db, insert, isCallId } from '@/lib/admin/server.ts';
import { callIsRecent, LIMITS } from '@/lib/limits.ts';

const allowed = async (callId: unknown) => isCallId(callId) && (await callIsRecent(callId, LIMITS.brainMinutes));

export async function POST(req: Request) {
  const { callId, reason, room } = (await req.json()) as { callId?: unknown; reason?: string; room?: string };
  if (!reason?.trim()) return Response.json({ error: 'bad request' }, { status: 400 });
  if (!(await allowed(callId))) return Response.json({ error: 'no recent call' }, { status: 429 });
  const res = await insert('frontdesk_escalations', { reason: clip(reason, 400), room: room ? clip(room, 8) : null });
  return res.ok ? Response.json({ ok: true }) : Response.json({ error: `escalation ${res.status}` }, { status: 502 });
}

export async function PATCH(req: Request) {
  const { id, status, callId } = (await req.json()) as { id?: string; status?: string; callId?: unknown };
  if (!id || !/^[0-9a-f-]{36}$/.test(id) || (status !== 'open' && status !== 'resolved')) return Response.json({ error: 'bad request' }, { status: 400 });
  if (!(await allowed(callId))) return Response.json({ error: 'Make a call first: changing records needs a recent call.' }, { status: 429 });
  const res = await db(`frontdesk_escalations?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null }),
  });
  return res.ok ? Response.json({ ok: true }) : Response.json({ error: `escalation ${res.status}` }, { status: 502 });
}
