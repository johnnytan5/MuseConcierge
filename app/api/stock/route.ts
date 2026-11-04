// An order leaves stock: one ledger row per item, with before and after. An
// item without a stock count still gets its row, with no counts; one that
// isn't in inventory_items at all (an Uber Eats order) is skipped.
import { clip, db, insert, isCallId } from '@/lib/admin/server.ts';
import { callIsRecent, LIMITS } from '@/lib/limits.ts';

const MAX_LINES = 3;

export async function POST(req: Request) {
  const { callId, taskId, lines } = (await req.json()) as { callId?: unknown; taskId?: string; lines?: { item?: string; qty?: number }[] };
  if (!isCallId(callId) || !Array.isArray(lines) || lines.length > MAX_LINES) return Response.json({ error: 'bad request' }, { status: 400 });
  if (!(await callIsRecent(callId, LIMITS.callMinutes))) return Response.json({ error: 'no recent call' }, { status: 429 });
  const moved = [];
  for (const l of lines) {
    const res = await db(`inventory_items?select=id,name,stock_count&name=eq.${encodeURIComponent(clip(l.item, 80))}`);
    const [item] = res.ok ? await res.json() : [];
    if (!item) continue;
    const qty = Math.min(5, Math.max(1, Math.round(Number(l.qty) || 1)));
    const tracked = item.stock_count !== null;
    const after = tracked ? Math.max(0, item.stock_count - qty) : null;
    if (tracked) await db(`inventory_items?id=eq.${item.id}`, { method: 'PATCH', body: JSON.stringify({ stock_count: after }) });
    await insert('inventory_audit_log', {
      item_id: item.id, item_name: item.name, delta: tracked ? (after as number) - item.stock_count : -qty, before_count: item.stock_count, after_count: after,
      task_id: `${callId.slice(-6)}-${clip(taskId, 8)}`, source: 'create_task',
    });
    moved.push({ item: item.name, after });
  }
  return Response.json({ moved });
}
