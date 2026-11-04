'use client';

// The hotel's records from the shared database, kept fresh by polling.
import { useCallback, useEffect, useState } from 'react';

export type Session = { id: string; agent_id: string | null; started_at: string; ended_at: string | null; room: string | null };
export type Turn = { id: string; session_id: string; role: 'guest' | 'agent'; text: string; created_at: string };
export type ToolEvent = { id: string; session_id: string | null; tool_name: string; arguments: unknown; result: unknown; result_summary: string | null; created_at: string };
export type Escalation = { id: string; reason: string; room: string | null; created_at: string; status: 'open' | 'resolved'; resolved_at: string | null };
export type Item = { id: string; name: string; category: string; price: number | null; available: boolean; stock_count: number | null };
export type LedgerRow = { id: string; item_name: string; delta: number; before_count: number | null; after_count: number | null; task_id: string | null; source: string; created_at: string };
export type Records = { sessions: Session[]; turns: Turn[]; tools: ToolEvent[]; escalations: Escalation[]; items: Item[]; ledger: LedgerRow[] };

const POLL_MS = 4000;

export function useRecords() {
  const [records, setRecords] = useState<Records | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/admin');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `records ${res.status}`);
      setRecords(body);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'records unavailable');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);
  return { records, error, refresh };
}
