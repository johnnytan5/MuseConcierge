// Spend limits for the hosted demo: a guest call must be started through
// /api/call/start (capped per IP per day), and the Meta-backed routes only
// serve requests that carry a recent call id. Skipped in development.
export const LIMITS = {
  callsPerIpPerDay: 3,
  callMinutes: 6, // agent and transcriber tokens: one call's length plus slack
  brainMinutes: 20, // the fleet keeps asking the brain after the call ends
};

const enforced = () => process.env.NODE_ENV === 'production';
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(5000),
  });

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function startCall(req: Request, visitorId: string): Promise<{ callId: string } | { error: string; status: number }> {
  const callId = `muse_${crypto.randomUUID().slice(0, 12)}`;
  if (!enforced()) return { callId };
  const ip = clientIp(req);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const res = await rest(`muse_calls?ip=eq.${encodeURIComponent(ip)}&started_at=gte.${since}&select=id`, { headers: { Prefer: 'count=exact' } });
  if (!res.ok) return { error: 'call limits unavailable', status: 503 };
  const used = Number(res.headers.get('content-range')?.split('/')[1] ?? 0);
  if (used >= LIMITS.callsPerIpPerDay) return { error: `Daily limit reached (${LIMITS.callsPerIpPerDay} calls). Try again tomorrow.`, status: 429 };
  const ins = await rest('muse_calls', { method: 'POST', body: JSON.stringify({ id: callId, ip, visitor_id: visitorId.slice(0, 64) }) });
  if (!ins.ok) return { error: 'call limits unavailable', status: 503 };
  return { callId };
}

const valid = new Map<string, number>(); // callId -> started_at ms, per server instance

export async function callIsRecent(callId: unknown, minutes: number): Promise<boolean> {
  if (!enforced()) return true;
  if (typeof callId !== 'string' || !/^muse_[a-f0-9-]{12}$/.test(callId)) return false;
  let started = valid.get(callId);
  if (started === undefined) {
    const res = await rest(`muse_calls?id=eq.${callId}&select=started_at`);
    const [row] = res.ok ? await res.json() : [];
    if (!row) return false;
    valid.set(callId, (started = Date.parse(row.started_at)));
  }
  return Date.now() - started < minutes * 60_000;
}
