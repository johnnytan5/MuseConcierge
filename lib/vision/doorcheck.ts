// What the robot's cameras check. At the door: SAM 3.1 finds the door and the
// room number sign, Muse Spark reads the number. In the cabin: SAM 3.1 looks
// for each item, before and after the guest collects. Pure helpers here; the
// model calls live in app/api/vision.

export type Box = { x1: number; y1: number; x2: number; y2: number; w: number; h: number; c: number };

export type DoorCheck = { door: Box | null; sign: Box | null; number: string | null; ms: number };

export type Verdict = 'confirmed' | 'wrong_door' | 'unsure';

const MIN_DOOR_CONFIDENCE = 0.5;

// SAM answers in text: <|box;x1=419;y1=137;x2=656;y2=641;w=1024;h=768;c=0.90|>
export function parseBoxes(text: string): Box[] {
  return [...text.matchAll(/<\|box;([^|]*)\|>/g)]
    .map((m) => Object.fromEntries(m[1].split(';').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)])))
    .filter((b) => ['x1', 'y1', 'x2', 'y2', 'w', 'h', 'c'].every((k) => Number.isFinite(b[k])))
    .sort((a, b) => b.c - a.c) as Box[];
}

// Spark is asked for the number only, but take the first 3- or 4-digit run anyway.
export function readRoomNumber(text: string): string | null {
  return text.match(/\b\d{3,4}\b/)?.[0] ?? null;
}

export function verdict(room: string, check: DoorCheck): Verdict {
  if (check.number && check.number !== room) return 'wrong_door';
  if (check.number === room && check.door && check.door.c >= MIN_DOOR_CONFIDENCE) return 'confirmed';
  return 'unsure';
}

// ---- Cabin check ---------------------------------------------------------

export const ITEM_KINDS = ['towel', 'shampoo', 'conditioner', 'food_bag', 'water', 'slippers', 'toothbrush'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

// What SAM 3.1 is asked, best first, measured on rendered cabin frames. The
// towel alone only answers to "fabric"; next to a bag, "towel" works. Generic
// prompts like "object" find nothing.
export const ITEM_PROMPTS: Record<ItemKind, string[]> = {
  towel: ['towel', 'fabric'],
  shampoo: ['shampoo bottle'],
  conditioner: ['conditioner bottle'],
  food_bag: ['green bag'],
  water: ['water bottle'],
  slippers: ['slipper'],
  toothbrush: ['toothbrush'],
};

export const ITEM_LABEL: Record<ItemKind, string> = {
  towel: 'towel', shampoo: 'shampoo', conditioner: 'conditioner', food_bag: 'food bag', water: 'water', slippers: 'slippers', toothbrush: 'toothbrush',
};

const FOOD = /uber|nasi|kuey|mee |roti|satay|sandwich|salad|fruit|congee|teh |kopi|juice|lemon tea|beer|house red/;

// The model that stands in for an inventory item; null if we have none, and
// then there is nothing for the cabin camera to look for.
export function kindFor(item: string): ItemKind | null {
  const n = item.toLowerCase();
  if (n.includes('towel')) return 'towel';
  if (n.includes('shampoo')) return 'shampoo';
  if (n.includes('conditioner')) return 'conditioner';
  if (n.includes('water')) return 'water';
  if (n.includes('slipper')) return 'slippers';
  if (n.includes('toothbrush') || n.includes('dental')) return 'toothbrush';
  return FOOD.test(n) ? 'food_bag' : null;
}

export type CabinCheck = { found: Partial<Record<ItemKind, Box | null>>; failed: ItemKind[]; ms: number };

// A failed call proves nothing, so it never counts as an empty cabin.
export function cabinVerdict(c: CabinCheck): 'empty' | 'occupied' | 'unknown' {
  if (Object.values(c.found).some(Boolean)) return 'occupied';
  return c.failed.length ? 'unknown' : 'empty';
}

function overlap(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const shared = w * h;
  return shared / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - shared);
}

// SAM answers each prompt alone, so "towel" can land on the bag next to it.
// One object is never two items: the item with the fewest candidates picks
// first (ties go to the surest), and the others take their best box that isn't already taken.
export function assignBoxes(candidates: Partial<Record<ItemKind, Box[]>>): Partial<Record<ItemKind, Box | null>> {
  const taken: Box[] = [];
  const found: Partial<Record<ItemKind, Box | null>> = {};
  const best = (k: ItemKind) => Math.max(0, ...candidates[k]!.map((b) => b.c));
  const kinds = (Object.keys(candidates) as ItemKind[]).sort((a, b) => candidates[a]!.length - candidates[b]!.length || best(b) - best(a));
  for (const k of kinds) {
    const box = candidates[k]!.find((b) => taken.every((t) => overlap(t, b) < 0.5)) ?? null;
    if (box) taken.push(box);
    found[k] = box;
  }
  return found;
}
