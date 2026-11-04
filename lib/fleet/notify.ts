// Guest-facing room notifications. Fixed wording from fleet events and brain
// decisions; the brain itself never writes guest copy.
import type { BrainDecision, FleetEvent, Task } from './types.ts';

export type RoomNotification = { room: string; text: string };

const minutes = (etaS: number) => Math.max(1, Math.round(etaS / 60));

export function notification(e: FleetEvent, d: BrainDecision | null, t: Task, etaS = 0): RoomNotification | null {
  if (t.kind !== 'guest') return null;
  if (e.type === 'arrived') return { room: t.room, text: 'Arrived, cabin open' };
  if (e.type === 'delivered') return { room: t.room, text: t.arrivedAt ? 'Collected, thank you' : 'Arrived' };
  if (e.type === 'not_collected') return { room: t.room, text: 'Missed you, please call the front desk' };
  if (!d) return null;
  if ('assign' in d) return { room: t.room, text: `On the way, about ${minutes(etaS)} min` };
  if ('handoff' in d || 'charge_then_continue' in d) return { room: t.room, text: `Delayed, about ${minutes(etaS)} min` };
  return null;
}
