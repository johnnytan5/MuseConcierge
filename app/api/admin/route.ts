// Everything the console's record tabs show, read in one go.
import { db } from '@/lib/admin/server.ts';

const SESSIONS = 40;
const LEDGER = 60;
// The database is shared with the earlier Concierge project. This route is public, so
// it only returns this project's records. Escalations carry no call id, so they go by date.
const MUSE_SINCE = '2026-11-04T17:00:00Z';

const rows = async (path: string) => {
  const res = await db(path);
  if (!res.ok) throw new Error(`${path.split('?')[0]} ${res.status}`);
  return res.json();
};

export async function GET() {
  try {
    const sessions = await rows(`voice_sessions?select=*&id=like.muse_*&order=started_at.desc&limit=${SESSIONS}`);
    const ids = sessions.map((s: { id: string }) => `"${s.id}"`).join(',');
    const [turns, tools, escalations, items, ledger] = await Promise.all([
      ids ? rows(`transcript_turns?select=*&session_id=in.(${ids})&order=created_at.asc&limit=2000`) : [],
      ids ? rows(`tool_call_events?select=*&session_id=in.(${ids})&order=created_at.asc&limit=2000`) : [],
      rows(`frontdesk_escalations?select=*&created_at=gte.${MUSE_SINCE}&order=created_at.desc&limit=100`),
      rows('inventory_items?select=id,name,category,price,available,stock_count&order=category,name'),
      rows(`inventory_audit_log?select=*&source=eq.create_task&order=created_at.desc&limit=${LEDGER}`),
    ]);
    return Response.json({ sessions, turns, tools, escalations, items, ledger });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'records unavailable' }, { status: 502 });
  }
}
