// The robot's camera checks. Door: SAM 3.1 boxes the door and the room number
// sign, Muse Spark reads the number, all in parallel. Any failure there just
// leaves that part empty. Cabin: SAM 3.1 looks for each item, and reports the
// ones it could not check so they are never mistaken for collected.
import { chat, segment, MODELS } from '@/lib/meta/client.ts';
import { parseBoxes, readRoomNumber, ITEM_KINDS, ITEM_PROMPTS, type Box, type CabinCheck, type DoorCheck, type ItemKind } from '@/lib/vision/doorcheck.ts';
import { ROOMS } from '@/lib/hotel.ts';
import { callIsRecent, LIMITS } from '@/lib/limits.ts';

const MAX_IMAGE_CHARS = 1_500_000; // a 640x480 JPEG is ~60 KB
const TIMEOUT_MS = 15000;

export async function POST(req: Request) {
  const { image, room, items, callId } = (await req.json()) as { image?: string; room?: string; items?: ItemKind[]; callId?: string };
  const validItems = Array.isArray(items) && items.length > 0 && items.length <= ITEM_KINDS.length && items.every((k) => ITEM_KINDS.includes(k));
  if (typeof image !== 'string' || !/^data:image\/(jpeg|png);base64,/.test(image) || image.length > MAX_IMAGE_CHARS || !(validItems || ROOMS.includes(room ?? ''))) {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  // Rides on the same allowance as the brain: arrivals come after the call ends.
  if (!(await callIsRecent(callId, LIMITS.brainMinutes))) return Response.json({ error: 'no recent call' }, { status: 429 });

  const t0 = Date.now();
  if (validItems) {
    const results = await Promise.all(items.map(async (kind) => {
      try {
        // Asked in parallel, but the first prompt to find it wins.
        const answers = await Promise.all(ITEM_PROMPTS[kind].map((p) => segment(p, image, TIMEOUT_MS)));
        return { kind, box: answers.map((t) => parseBoxes(t)[0]).find(Boolean) ?? null, ok: true };
      } catch {
        return { kind, box: null as Box | null, ok: false };
      }
    }));
    return Response.json({
      found: Object.fromEntries(results.filter((r) => r.ok).map((r) => [r.kind, r.box])),
      failed: results.filter((r) => !r.ok).map((r) => r.kind),
      ms: Date.now() - t0,
    } satisfies CabinCheck);
  }
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
