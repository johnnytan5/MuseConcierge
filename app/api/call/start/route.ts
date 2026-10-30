import { startCall } from '@/lib/limits.ts';

export async function POST(req: Request) {
  const { visitorId } = await req.json().catch(() => ({}));
  const r = await startCall(req, String(visitorId ?? ''));
  return 'callId' in r ? Response.json(r) : Response.json({ error: r.error }, { status: r.status });
}
