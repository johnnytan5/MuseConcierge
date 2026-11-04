// The hotel's records, in the same Supabase tables the Concierge project uses:
// calls (voice_sessions, transcript_turns, tool_call_events), escalations
// (frontdesk_escalations) and stock (inventory_items, inventory_audit_log).
// Server-side only: uses the service-role key.
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export async function db(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(8000),
  });
}

export const insert = (table: string, row: object) => db(table, { method: 'POST', body: JSON.stringify(row) });

export const isCallId = (id: unknown): id is string => typeof id === 'string' && /^muse_[a-f0-9-]{12}$/.test(id);

export const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n);
