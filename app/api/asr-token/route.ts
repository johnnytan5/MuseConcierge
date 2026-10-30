// Short-lived AssemblyAI token for the backup transcriber, so the browser
// never sees the API key.
import { callIsRecent, LIMITS } from '@/lib/limits.ts';

export async function GET(req: Request) {
  if (!(await callIsRecent(new URL(req.url).searchParams.get('callId'), LIMITS.callMinutes))) {
    return Response.json({ error: 'call expired' }, { status: 403 });
  }
  const res = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=300', {
    headers: { Authorization: process.env.ASSEMBLYAI_API_KEY ?? '' },
  });
  if (!res.ok) return Response.json({ error: `AssemblyAI token failed (${res.status})` }, { status: 502 });
  const { token } = await res.json();
  return Response.json({ token });
}
