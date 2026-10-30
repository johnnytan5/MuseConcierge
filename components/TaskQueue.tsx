import type { FleetSnapshot, TaskStatus } from '@/lib/fleet/types.ts';

const LABEL: Record<TaskStatus, string> = {
  queued: 'queued', assigned: 'assigned', en_route: 'en route', reassigned: 'reassigned', delivered: 'delivered', cancelled: 'cancelled',
};

function eta(etaAt: number | null, now: number, status: TaskStatus): string {
  if (!etaAt || status === 'delivered' || status === 'cancelled' || status === 'queued') return '—';
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
              <td>{t.qty > 1 ? `${t.qty}× ` : ''}{t.item}</td>
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
