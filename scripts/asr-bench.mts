// ASR bench: streams each bench clip at real-time pace through Muse Voice
// Transcribe and AssemblyAI Universal-Streaming, then scores room numbers,
// item names and end-of-speech delay. Decides which ASR the demo ships.
//
//   node --env-file=.env scripts/asr-bench.mts            # both providers
//   node --env-file=.env scripts/asr-bench.mts meta       # one provider
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const FRAME_MS = 80;
const RATE = 16000;
const FRAME_BYTES = (RATE * 2 * FRAME_MS) / 1000;
const TAIL_SILENCE_MS = 3000; // room for endpointing to fire
const ROOMS = ['805', '806', '807', '1203', '1204', '1205'];
// KEYWORDS=phrases biases on "room 805" etc.: bare numbers let Muse hear
// "room eight..." as "roommate".
const KEYWORDS = [...(process.env.KEYWORDS === 'phrases' ? ROOMS.map((r) => `room ${r}`) : ROOMS), 'towel', 'water', 'toothbrush', 'pillow', 'slippers'];

type Clip = { id: string; voice: string; text: string; room: string; item: string; pcm: Buffer; speechEndMs: number };
type Result = { transcript: string; endDelayMs: number | null; error?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadClips(): Clip[] {
  return readFileSync('bench/requests.tsv', 'utf8').trim().split('\n').map((line) => {
    const [id, voice, text, room, item] = line.split('\t');
    const wav = readFileSync(`bench/clips/${id}.wav`);
    const at = wav.indexOf('data');
    const pcm = wav.subarray(at + 8, at + 8 + wav.readUInt32LE(at + 4));
    let last = 0;
    for (let i = 0; i < pcm.length; i += 2) if (Math.abs(pcm.readInt16LE(i)) > 500) last = i;
    return { id, voice, text, room, item, pcm, speechEndMs: (last / 2 / RATE) * 1000 };
  });
}

// Sends the clip then trailing silence at real time; returns the wall time
// at which the end of speech was sent, so delays are measured from there.
async function stream(ws: WebSocket, clip: Clip, done: () => boolean): Promise<number> {
  const audio = Buffer.concat([clip.pcm, Buffer.alloc((RATE * 2 * TAIL_SILENCE_MS) / 1000)]);
  const t0 = performance.now();
  let speechEndAt = 0;
  for (let off = 0, i = 0; off < audio.length && !done(); off += FRAME_BYTES, i++) {
    const wait = t0 + i * FRAME_MS - performance.now();
    if (wait > 0) await sleep(wait);
    if (ws.readyState !== WebSocket.OPEN) break;
    ws.send(audio.subarray(off, off + FRAME_BYTES));
    if (!speechEndAt && (off + FRAME_BYTES) / 2 / RATE * 1000 >= clip.speechEndMs) speechEndAt = performance.now();
  }
  return speechEndAt;
}

function runMeta(clip: Clip): Promise<Result> {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://api.meta.ai/v1/asr/realtime');
    let transcript = '';
    let completeAt = 0;
    let speechEndAt = 0;
    let error: string | undefined;
    const finish = () => resolve({ transcript, endDelayMs: completeAt && speechEndAt ? completeAt - speechEndAt : null, error });
    const timer = setTimeout(() => { error ??= 'timeout'; ws.close(); }, 30000);
    ws.onopen = () => ws.send(JSON.stringify({
      authorization: { accessToken: `Bearer ${process.env.META_API_KEY}` },
      audioEncoding: 'PCM_16KHZ',
      model: 'muse-voice-transcribe-1.0',
      mode: 'ENDPOINTING',
      emitAudioProgress: false,
      keywords: KEYWORDS,
      languageBias: ['English'],
    }));
    ws.onmessage = async (ev) => {
      const m = JSON.parse(String(ev.data));
      if (!m.type && m.sessionId) {
        speechEndAt = await stream(ws, clip, () => completeAt > 0);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'endStream' }));
      } else if (m.type === 'speechComplete') {
        completeAt ||= performance.now();
        transcript = [transcript, m.transcript].filter(Boolean).join(' ');
        setTimeout(() => ws.close(), 300);
      } else if (m.type === 'transcript' && m.final && !transcript) {
        transcript = m.transcript;
      } else if (m.type === 'error') {
        error = m.message;
      }
    };
    ws.onerror = () => { error ??= 'socket error'; };
    ws.onclose = (ev) => { clearTimeout(timer); if (ev.code !== 1000 && ev.code !== 1005 && !error && !transcript) error = `close ${ev.code} ${ev.reason}`; finish(); };
  });
}

async function runAssembly(clip: Clip): Promise<Result> {
  const tr = await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=60', {
    headers: { Authorization: process.env.ASSEMBLYAI_API_KEY ?? '' },
  });
  if (!tr.ok) return { transcript: '', endDelayMs: null, error: `token ${tr.status}` };
  const { token } = await tr.json();
  const qs = new URLSearchParams({
    sample_rate: String(RATE), encoding: 'pcm_s16le', format_turns: 'true',
    keyterms_prompt: JSON.stringify(KEYWORDS), token,
  });
  return new Promise((resolve) => {
    const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${qs}`);
    let transcript = '';
    let formattedAt = 0;
    let speechEndAt = 0;
    let error: string | undefined;
    const timer = setTimeout(() => { error ??= 'timeout'; ws.close(); }, 30000);
    ws.onmessage = async (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.type === 'Begin') {
        speechEndAt = await stream(ws, clip, () => formattedAt > 0);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'Terminate' }));
      } else if (m.type === 'Turn' && m.end_of_turn && m.turn_is_formatted) {
        formattedAt ||= performance.now();
        transcript = [transcript, m.transcript].filter(Boolean).join(' ');
      } else if (m.type === 'Termination') {
        ws.close();
      } else if (m.error) {
        error = m.error;
      }
    };
    ws.onerror = () => { error ??= 'socket error'; };
    ws.onclose = (ev) => {
      clearTimeout(timer);
      if (!transcript && !error) error = `close ${ev.code} ${ev.reason}`;
      resolve({ transcript, endDelayMs: formattedAt && speechEndAt ? formattedAt - speechEndAt : null, error });
    };
  });
}

// "twelve oh four", "1,204", "12 04" all count as 1204: the agent reads the
// number back, so spelled-out digits are fine; only a wrong number is an error.
const WORDS: Record<string, string> = { zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', twelve: '12' };
export function roomHeard(transcript: string, room: string): boolean {
  const t = transcript.toLowerCase().replace(/eight hundred (and )?/g, '80 ');
  const digits = t.split(/[^a-z0-9]+/).map((w) => WORDS[w] ?? (/^\d+$/.test(w) ? w : ' ')).join('').split(' ');
  return digits.some((run) => run.includes(room));
}
export const itemHeard = (t: string, item: string) => t.toLowerCase().includes(item);

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

if (import.meta.main) {
  const only = process.argv[2];
  const providers: [string, (c: Clip) => Promise<Result>][] = [['meta', runMeta], ['assemblyai', runAssembly]];
  const clips = loadClips();
  const rows: Record<string, unknown>[] = [];
  for (const [name, run] of providers.filter(([n]) => !only || n === only)) {
    for (const clip of clips) {
      let r = await run(clip);
      // AssemblyAI counts a session as open for a moment after close.
      for (let n = 0; n < 3 && r.error?.includes('concurrent'); n++) { await sleep(5000); r = await run(clip); }
      await sleep(1500);
      const row = { provider: name, id: clip.id, voice: clip.voice, room: roomHeard(r.transcript, clip.room), item: itemHeard(r.transcript, clip.item), delayMs: r.endDelayMs && Math.round(r.endDelayMs), transcript: r.transcript, error: r.error };
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
  console.log('\n| Provider | Rooms right | Items right | Median end-of-speech delay | Errors |\n|---|---|---|---|---|');
  for (const p of new Set(rows.map((r) => r.provider))) {
    const mine = rows.filter((r) => r.provider === p);
    const delays = mine.map((r) => r.delayMs).filter((d): d is number => typeof d === 'number');
    console.log(`| ${p} | ${mine.filter((r) => r.room).length}/${mine.length} | ${mine.filter((r) => r.item).length}/${mine.length} | ${Math.round(median(delays))} ms | ${mine.filter((r) => r.error).length} |`);
  }
  mkdirSync('bench/out', { recursive: true });
  writeFileSync(`bench/out/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(rows, null, 2));
}
