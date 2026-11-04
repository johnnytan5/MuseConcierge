// One line of a call's record: something said, a tool call, or an action the
// fleet took for this call. Best effort: a call never waits on its log.
import { clip, db, insert, isCallId } from '@/lib/admin/server.ts';
import { callIsRecent, LIMITS } from '@/lib/limits.ts';

const MAX_TEXT = 4000;
const MAX_JSON = 8000; // a brain decision with its options fits; photos are never logged

const sized = (v: unknown) => (JSON.stringify(v ?? null).length <= MAX_JSON ? v ?? null : { truncated: true });

export async function POST(req: Request) {
  const b = (await req.json()) as {
    callId?: unknown;
    turn?: { role?: string; text?: string };
    tool?: { name?: string; args?: unknown; result?: unknown; summary?: string };
    end?: boolean;
    room?: string;
  };
  if (!isCallId(b.callId)) return Response.json({ error: 'bad request' }, { status: 400 });
  if (!(await callIsRecent(b.callId, LIMITS.brainMinutes))) return Response.json({ error: 'no recent call' }, { status: 429 });
  const res = b.turn
    ? await insert('transcript_turns', { session_id: b.callId, role: b.turn.role === 'guest' ? 'guest' : 'agent', text: clip(b.turn.text, MAX_TEXT) })
    : b.tool
      ? await insert('tool_call_events', {
        session_id: b.callId,
        tool_name: clip(b.tool.name, 60),
        arguments: sized(b.tool.args),
        result: sized(b.tool.result),
        result_summary: clip(b.tool.summary, MAX_TEXT),
      })
      : await db(`voice_sessions?id=eq.${b.callId}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...(b.end ? { ended_at: new Date().toISOString() } : {}), ...(b.room ? { room: clip(b.room, 8) } : {}) }),
      });
  return res.ok ? Response.json({ ok: true }) : Response.json({ error: `log ${res.status}` }, { status: 502 });
}
