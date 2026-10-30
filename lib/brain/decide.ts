// Turning the brain's reply into a decision the engine will accept. The
// model may only pick one of the engine's options; anything else, or no
// reply in time, falls back to the fastest feasible option.
import type { BrainDecision, Option } from '../fleet/types.ts';

const MAX_REASON = 120;

export function decisionFor(taskId: string, o: Option, reason: string): BrainDecision {
  switch (o.action) {
    case 'assign': return { assign: taskId, to: o.robot, reason };
    case 'handoff': return { handoff: taskId, to: o.to, preempt: o.preempts, reason };
    case 'charge_then_continue': return { charge_then_continue: taskId, reason };
    case 'continue': return { continue: taskId, reason };
    case 'wait': return { wait: taskId, reason };
  }
}

// Does decision d pick option o for this task?
function picks(d: Record<string, unknown>, taskId: string, o: Option): boolean {
  switch (o.action) {
    case 'assign': return d.assign === taskId && d.to === o.robot;
    case 'handoff': return d.handoff === taskId && d.to === o.to && (d.preempt ?? null) === o.preempts;
    case 'charge_then_continue': return d.charge_then_continue === taskId;
    case 'continue': return d.continue === taskId && o.feasible;
    case 'wait': return d.wait === taskId;
  }
}

export function parseDecision(text: string, taskId: string, options: Option[]): BrainDecision | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const chosen = options.find((o) => picks(raw, taskId, o));
  if (!chosen) return null;
  return decisionFor(taskId, chosen, String(raw.reason ?? '').slice(0, MAX_REASON));
}

export function fallbackDecision(taskId: string, options: Option[]): BrainDecision {
  const usable = options
    .filter((o): o is Exclude<Option, { action: 'wait' }> => o.action !== 'wait' && (o.action !== 'continue' || o.feasible))
    .sort((a, b) => a.eta_s - b.eta_s);
  if (!usable.length) return { wait: taskId, reason: 'no robot free' };
  return decisionFor(taskId, usable[0], `fastest option (${usable[0].eta_s} s)`);
}
