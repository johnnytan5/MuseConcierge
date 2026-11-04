import type { FleetSnapshot } from './types.ts';

export function metrics(s: FleetSnapshot): { delivered: number; avgDeliveryS: number | null; handoffs: number } {
  const done = s.tasks.filter((t) => t.kind === 'guest' && t.status === 'delivered' && t.deliveredAt !== null);
  // Time to the door: how long a guest then takes to collect isn't the fleet's.
  const total = done.reduce((sum, t) => sum + ((t.arrivedAt ?? t.deliveredAt!) - t.createdAt), 0);
  return {
    delivered: done.length,
    avgDeliveryS: done.length ? Math.round(total / done.length / 1000) : null,
    handoffs: s.tasks.reduce((n, t) => n + t.history.filter((h) => h.status === 'reassigned').length, 0),
  };
}
