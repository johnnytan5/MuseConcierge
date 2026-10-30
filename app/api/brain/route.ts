// One brain decision per fleet event, on Muse Wonder. Any failure (timeout,
// junk, an option that was not offered) falls back to the fastest feasible
// option, so a delivery never waits on the model.
import { chat, MODELS } from '@/lib/meta/client.ts';
import { BRAIN_SYSTEM, brainQuestion } from '@/lib/brain/prompt.ts';
import { parseDecision, fallbackDecision } from '@/lib/brain/decide.ts';
import type { FleetEvent, FleetSnapshot, Option } from '@/lib/fleet/types.ts';
import { callIsRecent, LIMITS } from '@/lib/limits.ts';

const TIMEOUT_MS = 15000; // Wonder at minimal effort: 1.7-7 s typical, rare outliers past 12 s

export async function POST(req: Request) {
  const body = (await req.json()) as { event: FleetEvent; taskId: string; options: Option[]; snapshot: FleetSnapshot; callId?: string };
  const { event, taskId, options, snapshot } = body;
  // Over the limit the fleet still runs: the fallback rule decides instead of Wonder.
  if (!(await callIsRecent(body.callId, LIMITS.brainMinutes)) && Array.isArray(options) && options.length) {
    return Response.json({ decision: fallbackDecision(taskId, options), source: 'fallback', error: 'no recent call', ms: 0 });
  }
  if (!event?.type || typeof taskId !== 'string' || !Array.isArray(options) || !options.length || options.length > 8 || !snapshot?.robots) {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  const t0 = Date.now();
  let error = '';
  try {
    const msg = await chat({
      model: MODELS.brain,
      messages: [
        { role: 'system', content: BRAIN_SYSTEM },
        { role: 'user', content: brainQuestion(event, taskId, options, snapshot) },
      ],
      maxTokens: 2000,
      // Wonder picks correctly at minimal effort in ~6 s vs ~11 s at low (scripts/brain-check.mts).
      reasoningEffort: 'minimal',
      timeoutMs: TIMEOUT_MS,
    });
    const decision = parseDecision(msg.content ?? '', taskId, options);
    if (decision) return Response.json({ decision, source: 'model', model: MODELS.brain, ms: Date.now() - t0 });
    error = `unusable reply: ${(msg.content ?? '').slice(0, 120)}`;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 160) : 'brain failed';
  }
  return Response.json({ decision: fallbackDecision(taskId, options), source: 'fallback', error, ms: Date.now() - t0 });
}
