import type { FleetSnapshot } from '@/lib/fleet/types.ts';
import { metrics } from '@/lib/fleet/metrics.ts';

export default function MetricsBar({ snap }: { snap: FleetSnapshot | null }) {
  const m = snap ? metrics(snap) : null;
  return (
    <div className="metrics">
      <div><b>{m?.delivered ?? 0}</b><span>delivered</span></div>
      <div><b>{m?.avgDeliveryS != null ? `${m.avgDeliveryS} s` : '—'}</b><span>avg delivery</span></div>
      <div><b>{m?.handoffs ?? 0}</b><span>recoveries</span></div>
    </div>
  );
}
