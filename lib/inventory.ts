// Inventory from the existing Supabase project (inventory_items). Server-side
// only: uses the service-role key.
export type InventoryItem = { name: string; category: string; available: boolean; stock_count: number | null };

const TTL_MS = 60_000;
let cache: { at: number; items: InventoryItem[] } | null = null;

export async function loadInventory(): Promise<InventoryItem[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/inventory_items?select=name,category,available,stock_count&order=category,name`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`inventory ${res.status}`);
  cache = { at: Date.now(), items: await res.json() };
  return cache.items;
}

// Guests' own delivery-app orders wait at the front desk; a robot brings them up.
const FRONT_DESK: InventoryItem[] = [{ name: 'uber eats order', category: 'parcels waiting at the front desk', available: true, stock_count: null }];

// What the agent may offer: available and not known to be out of stock.
export const deliverable = (items: InventoryItem[]) =>
  [...items, ...FRONT_DESK].filter((i) => i.available && (i.stock_count === null || i.stock_count > 0));
