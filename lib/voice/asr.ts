// Mic → 16 kHz PCM16 frames → the chosen speech-to-text provider. Callers
// only see onPartial/onFinal, never which provider is in use.
import type { Gate } from './gate.ts';
import { ROOMS } from '../hotel.ts';
import { connectMeta } from './asr-meta.ts';
import { connectAssemblyAI } from './asr-assemblyai.ts';

export type AsrProvider = 'meta' | 'assemblyai';

export type AsrHandlers = { onPartial(t: string): void; onFinal(t: string): void; onError(msg: string): void };

// The adapter contract each provider implements.
export type AsrConnection = { send(frame: ArrayBuffer): void; close(): void };

export const KEYWORDS = [
  // Phrases, not bare numbers: Muse hears "room eight..." as "roommate" otherwise.
  ...ROOMS.map((r) => `room ${r}`),
  'towel', 'water', 'toothbrush', 'pillow', 'slippers',
];

export async function openAsr(opts: AsrHandlers & {
  provider: AsrProvider;
  callId: string; // authorises the backup transcriber's token
  stream: MediaStream;
  keywords: string[];
  gate: Gate;
}): Promise<{ stop(): void }> {
  const conn = opts.provider === 'meta'
    ? await connectMeta(opts.keywords, opts)
    : await connectAssemblyAI(opts.keywords, opts, opts.callId);

  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('/voice/mic-worklet.js');
  const src = ctx.createMediaStreamSource(opts.stream);
  const node = new AudioWorkletNode(ctx, 'mic-pcm16');
  // Muse closes a session whose audio arrives slower than real time, so a
  // gated frame is sent as silence rather than dropped.
  node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) =>
    conn.send(opts.gate.shouldSend() ? ev.data : new ArrayBuffer(ev.data.byteLength));
  src.connect(node);

  return {
    stop() {
      src.disconnect();
      node.disconnect();
      void ctx.close();
      conn.close();
    },
  };
}
