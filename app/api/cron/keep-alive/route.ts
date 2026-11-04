// Vercel cron (vercel.json): a daily read so Supabase doesn't pause the project
// for inactivity. Vercel sends CRON_SECRET as a bearer token; without that
// secret set, the route refuses everything. Returns no data, only that it ran.
import { db } from '@/lib/admin/server.ts';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const res = await db('voice_sessions?select=id,transcript_turns(id),tool_call_events(id)&limit=1');
  return res.ok ? Response.json({ ok: true, at: new Date().toISOString() }) : Response.json({ error: `database ${res.status}` }, { status: 502 });
}
