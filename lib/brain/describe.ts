// Plain-language brain log lines, written by the console from the brain's
// JSON so the model never writes copy that people read.
import type { BrainDecision, FleetEvent, Option, RobotId } from '../fleet/types.ts';

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

// One row of the options the engine offered, for the plan card.
export function optionLabel(o: Option): { text: string; eta: string } {
  const eta = 'eta_s' in o ? (o.eta_s < 90 ? `${o.eta_s} s` : `${Math.round(o.eta_s / 60)} min`) : '';
  switch (o.action) {
    case 'assign': return { text: `Send ${name(o.robot)}`, eta };
    case 'continue': return { text: o.feasible ? 'Carry on' : `Carry on: not enough battery${o.why ? `, ${o.why}` : ''}`, eta: o.feasible ? eta : 'no' };
    case 'charge_then_continue': return { text: 'Charge first, then carry on', eta };
    case 'handoff': return { text: `Hand off to ${name(o.to)}${o.preempts ? `, pausing ${o.preempts}` : ''}`, eta };
    case 'wait': return { text: 'Wait for a free robot', eta: '' };
  }
}

// What the decision sets in motion, in order, written from the decision alone.
export function planSteps(e: FleetEvent, d: BrainDecision, room: string | undefined, etaS?: number): string[] {
  const at = room ? `room ${room}` : 'the room';
  const by = etaS ? ` in about ${etaS < 90 ? `${etaS} s` : `${Math.round(etaS / 60)} min`}` : '';
  if ('handoff' in d) {
    const from = e.type === 'battery_fault' ? name(e.robotId) : 'the robot';
    return [
      `${cap(from)} stops and goes home to charge`,
      ...(d.preempt ? [`${cap(name(d.to))} pauses ${d.preempt}, which goes back in the queue`] : []),
      `${cap(name(d.to))} goes to the pickup and loads ${d.handoff}`,
      `${cap(name(d.to))} reaches ${at}${by}`,
      `${cap(at)} is told about the delay`,
      ...(d.preempt ? [`${d.preempt} resumes as soon as a robot is free`] : []),
    ];
  }
  if ('assign' in d) return [`${cap(name(d.to))} goes to the pickup and loads ${d.assign}`, `${cap(name(d.to))} reaches ${at}${by}`];
  if ('charge_then_continue' in d) return ['The robot goes home and charges', `It then carries on to ${at}${by}`, `${cap(at)} is told about the delay`];
  if ('continue' in d) return [`The robot carries on to ${at}${by}`];
  return ['The order stays queued until a robot is free'];
}
