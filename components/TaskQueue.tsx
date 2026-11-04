import { lineItems, type FleetSnapshot, type TaskStatus } from '@/lib/fleet/types.ts';

const LABEL: Record<TaskStatus, string> = {
  queued: 'queued', assigned: 'assigned', en_route: 'en route', reassigned: 'reassigned', at_door: 'at door', delivered: 'collected', not_collected: 'not collected', cancelled: 'cancelled',
};

function eta(etaAt: number | null, now: number, status: TaskStatus): string {
  if (!etaAt || status === 'delivered' || status === 'cancelled' || status === 'queued' || status === 'at_door' || status === 'not_collected') return '—';
  const s = Math.max(0, Math.round((etaAt - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function TaskQueue({ snap }: { snap: FleetSnapshot | null }) {
  const tasks = [...(snap?.tasks ?? [])].reverse();
  return (
    <section className="panel">
      <h2>Task queue</h2>
      <table className="tasks">
        <thead><tr><th>Task</th><th>Room</th><th>Item</th><th>Robot</th><th>Status</th><th>ETA</th></tr></thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className={t.kind}>
              <td>{t.id}</td>
              <td>{t.room}</td>
              <td>{lineItems(t).map((l) => `${l.qty > 1 ? `${l.qty}× ` : ''}${l.item}`).join(' + ')}</td>
              <td>{t.robotId ? t.robotId.replace('robot_', 'R') : '—'}</td>
              {/* keyed on status: the cell remounts and flashes when it changes */}
              <td key={t.status} className={`status ${t.status}`}>{LABEL[t.status]}</td>
              <td>{eta(t.etaAt, snap!.now, t.status)}</td>
            </tr>
          ))}
          {!tasks.length && <tr><td colSpan={6} className="muted">No tasks</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
