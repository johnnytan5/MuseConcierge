// The agent's voice: AssemblyAI TTS, streamed through here so the API key stays
// on the server. Change the voice with TTS_VOICE (any AssemblyAI voice id).
import { callIsRecent, LIMITS } from '@/lib/limits.ts';

const URL = 'https://tts.us.assemblyai.com/v1/speech';
const VOICE = process.env.TTS_VOICE ?? 'aai-sara';
const MAX_CHARS = 1000; // a spoken reply is a sentence or two; this caps spend
const FIRST_AUDIO_TIMEOUT_MS = 5000; // past this the page falls back to the browser voice

export async function POST(req: Request) {
  const { text, callId } = (await req.json()) as { text?: unknown; callId?: unknown };
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_CHARS) return Response.json({ error: 'bad request' }, { status: 400 });
  if (!(await callIsRecent(callId, LIMITS.callMinutes))) return Response.json({ error: 'no recent call' }, { status: 429 });
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: process.env.ASSEMBLYAI_API_KEY ?? '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: VOICE }),
      signal: AbortSignal.timeout(FIRST_AUDIO_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) return Response.json({ error: `tts ${res.status}` }, { status: 502 });
    return new Response(res.body, {
      headers: { 'Content-Type': 'application/octet-stream', 'X-Sample-Rate': res.headers.get('x-tts-sample-rate') ?? '24000' },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 120) : 'tts failed' }, { status: 502 });
  }
}
