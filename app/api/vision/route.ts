// Door check when a robot reaches a guest's door: SAM 3.1 boxes the door and
// the room number sign, Muse Spark reads the number, all three in parallel.
// Advisory only: the delivery has already completed, so any failure just
// leaves that part of the check empty.
import { chat, segment, MODELS } from '@/lib/meta/client.ts';
import { parseBoxes, readRoomNumber, type DoorCheck } from '@/lib/vision/doorcheck.ts';
import { ROOMS } from '@/lib/hotel.ts';
import { callIsRecent, LIMITS } from '@/lib/limits.ts';

const MAX_IMAGE_CHARS = 1_500_000; // a 640x480 JPEG is ~60 KB
const TIMEOUT_MS = 15000;

export async function POST(req: Request) {
  const { image, room, callId } = (await req.json()) as { image?: string; room?: string; callId?: string };
  if (typeof image !== 'string' || !/^data:image\/(jpeg|png);base64,/.test(image) || image.length > MAX_IMAGE_CHARS || !ROOMS.includes(room ?? '')) {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  // Rides on the same allowance as the brain: arrivals come after the call ends.
  if (!(await callIsRecent(callId, LIMITS.brainMinutes))) return Response.json({ error: 'no recent call' }, { status: 429 });

  const t0 = Date.now();
  const box = (prompt: string) => segment(prompt, image, TIMEOUT_MS).then((t) => parseBoxes(t)[0] ?? null).catch(() => null);
  const [door, sign, number] = await Promise.all([
    box('door'),
    box('room number sign'),
    chat({
      model: MODELS.spark,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'What room number is on the sign next to the door? Answer with the number only.' },
        { type: 'image_url', image_url: { url: image } },
      ] }],
      maxTokens: 400,
      reasoningEffort: 'minimal',
      timeoutMs: TIMEOUT_MS,
    }).then((m) => readRoomNumber(m.content ?? '')).catch(() => null),
  ]);
  return Response.json({ door, sign, number, ms: Date.now() - t0 } satisfies DoorCheck);
}
