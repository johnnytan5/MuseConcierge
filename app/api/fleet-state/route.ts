// Saved fleet run per browser (visitor id from localStorage) in Supabase
// table muse_fleet_state. Until the migration is applied this answers 503
// and the page simply runs without persistence.
const TABLE = 'muse_fleet_state';
const MAX_BYTES = 256 * 1024;
const STALE_MS = 30 * 60 * 1000; // an older run restarts the demo fresh
const ID = /^[a-z0-9-]{8,64}$/;

const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(5000),
  });

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!ID.test(id)) return Response.json({ error: 'bad id' }, { status: 400 });
  const res = await rest(`${TABLE}?id=eq.${id}&select=snapshot,brain_log,notifications,updated_at`);
  if (!res.ok) return Response.json({ error: `state store unavailable (${res.status})` }, { status: 503 });
  const [row] = await res.json();
  if (!row || Date.now() - Date.parse(row.updated_at) > STALE_MS) return Response.json({ state: null });
  return Response.json({ state: row });
}

// ponytail: no auth on writes; a visitor can only overwrite their own random id's row.
export async function PUT(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: 'too large' }, { status: 413 });
  const { id, snapshot, brain_log, notifications } = JSON.parse(text);
  if (!ID.test(id ?? '')) return Response.json({ error: 'bad id' }, { status: 400 });
  const res = await rest(TABLE, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id, snapshot, brain_log: brain_log ?? [], notifications: notifications ?? [], updated_at: new Date().toISOString() }),
  });
  if (!res.ok) return Response.json({ error: `state store unavailable (${res.status})` }, { status: 503 });
  return Response.json({ ok: true });
}
