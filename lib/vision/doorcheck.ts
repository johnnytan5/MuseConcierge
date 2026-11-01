// Door check on arrival: SAM 3.1 finds the door and the room number sign in
// the robot's camera frame, Muse Spark reads the number. Pure helpers here;
// the model calls live in app/api/vision.

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

// Spark is asked for the number only, but take the first 3-digit run anyway.
export function readRoomNumber(text: string): string | null {
  return text.match(/\b\d{3}\b/)?.[0] ?? null;
}

export function verdict(room: string, check: DoorCheck): Verdict {
  if (check.number && check.number !== room) return 'wrong_door';
  if (check.number === room && check.door && check.door.c >= MIN_DOOR_CONFIDENCE) return 'confirmed';
  return 'unsure';
}
