'use client';

// What the assistant couldn't handle, waiting on the front desk.
import { useState } from 'react';
import { setEscalation } from '@/lib/admin/client.ts';
import type { Records } from './useRecords.ts';

export default function EscalationsPanel({ records, callId, onChange }: { records: Records | null; callId: string | null; onChange: () => void }) {
  const [filter, setFilter] = useState<'Open' | 'Resolved' | 'All'>('Open');
  const [error, setError] = useState('');
  const rows = (records?.escalations ?? []).filter((e) => filter === 'All' || e.status === filter.toLowerCase());
  const change = async (id: string, status: 'open' | 'resolved') => {
    const err = await setEscalation(id, status, callId);
    setError(err ?? '');
    onChange();
  };
  return (
    <>
      <div className="filters">
        {(['Open', 'Resolved', 'All'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>)}
      </div>
      {error && <p className="top-error">{error}</p>}
      <section className="panel rows">
        {rows.map((e) => (
          <div key={e.id} className={`escalation ${e.status}`}>
            <b>{e.room ?? '—'}</b>
            <div>
              <strong>{e.reason}</strong>
              <small className="mono muted">{new Date(e.created_at).toLocaleString()}{e.resolved_at ? ` · resolved ${new Date(e.resolved_at).toLocaleTimeString()}` : ''}</small>
            </div>
            <span className="tag">{e.status === 'open' ? 'Open' : 'Resolved'}</span>
            <button className="btn small" onClick={() => change(e.id, e.status === 'open' ? 'resolved' : 'open')}>{e.status === 'open' ? 'Resolve' : 'Reopen'}</button>
          </div>
        ))}
        {!rows.length && <p className="muted pad">{filter === 'Open' ? 'Nothing needs you. Anything the assistant can’t resolve lands here.' : 'Nothing here'}</p>}
      </section>
    </>
  );
}
