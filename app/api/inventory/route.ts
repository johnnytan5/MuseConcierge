import { loadInventory, deliverable } from '@/lib/inventory.ts';

export async function GET() {
  try {
    return Response.json({ items: deliverable(await loadInventory()).map((i) => i.name) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'inventory failed' }, { status: 502 });
  }
}
