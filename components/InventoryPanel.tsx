'use client';

// What the hotel can deliver, and every stock change with before and after.
import type { Records } from './useRecords.ts';

export default function InventoryPanel({ records }: { records: Records | null }) {
  return (
    <>
      <section className="panel">
        <table className="tasks stock">
          <thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead>
          <tbody>
            {records?.items.map((i) => (
              <tr key={i.id}>
                <td><strong>{i.name}</strong></td>
                <td>{i.category}</td>
                <td className="mono">{i.price ?? '—'}</td>
                <td className="mono">{i.stock_count ?? '—'}</td>
                <td>{!i.available ? 'Unavailable' : i.stock_count === 0 ? 'Out of stock' : 'In stock'}</td>
              </tr>
            ))}
            {!records && <tr><td colSpan={5} className="muted">Loading inventory…</td></tr>}
          </tbody>
        </table>
      </section>
      <section className="panel ledger">
        <h2>Stock ledger</h2>
        <table className="tasks stock">
          <thead><tr><th>Time</th><th>Item</th><th>Change</th><th>Before</th><th>After</th><th>Why</th></tr></thead>
          <tbody>
            {records?.ledger.map((l) => (
              <tr key={l.id}>
                <td className="mono">{new Date(l.created_at).toLocaleString()}</td>
                <td><strong>{l.item_name}</strong></td>
                <td className="mono">{l.delta > 0 ? `+${l.delta}` : `−${Math.abs(l.delta)}`}</td>
                <td className="mono">{l.before_count ?? '—'}</td>
                <td className="mono">{l.after_count ?? '—'}</td>
                <td className="mono">{l.source}{l.task_id ? ` ${l.task_id}` : ''}</td>
              </tr>
            ))}
            {records?.ledger.length === 0 && <tr><td colSpan={6} className="muted">No stock has changed yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
