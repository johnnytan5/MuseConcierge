import { startCall } from '@/lib/limits.ts';
import { insert } from '@/lib/admin/server.ts';
import { MODELS } from '@/lib/meta/client.ts';

export async function POST(req: Request) {
  const { visitorId } = await req.json().catch(() => ({}));
  const r = await startCall(req, String(visitorId ?? ''));
  if (!('callId' in r)) return Response.json({ error: r.error }, { status: r.status });
  // Opens the call's record. A call still works if this fails.
  await insert('voice_sessions', { id: r.callId, agent_id: MODELS.spark }).catch(() => {});
  return Response.json(r);
}
