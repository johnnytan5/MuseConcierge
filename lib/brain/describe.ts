// Plain-language brain log lines, written by the console from the brain's
// JSON so the model never writes copy that people read.
import type { BrainDecision, FleetEvent, RobotId } from '../fleet/types.ts';

const name = (r: RobotId) => r.replace('robot_', 'robot ');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function describe(e: FleetEvent, d: BrainDecision, etaS?: number): string {
  const why = d.reason ? ` (${d.reason})` : '';
  if ('assign' in d) {
    return e.type === 'robot_idle'
      ? `${cap(name(e.robotId))} free → ${d.assign} resumed on ${name(d.to)}${why}`
      : `New order ${d.assign} → ${name(d.to)}${why}`;
  }
  const fault = e.type === 'battery_fault' ? `Battery fault on ${name(e.robotId)}` : 'Fleet';
  if ('handoff' in d) return `${fault} → ${d.handoff} handed to ${name(d.to)}${d.preempt ? `, ${d.preempt} paused` : ''}${why}`;
  if ('charge_then_continue' in d) return `${fault} → charging first${etaS ? `, ETA +${Math.round(etaS / 60)} min` : ''}${why}`;
  if ('continue' in d) return `${fault} → continuing with ${d.continue}${why}`;
  return `${d.wait} waiting for a free robot${why}`;
}
