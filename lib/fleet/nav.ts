// One hotel floor as a waypoint graph, plus pure-pursuit steering. The MJCF
// scene in public/sim/floor.xml is laid out on the same coordinates (metres).
import type { Point, Pose } from './types.ts';

export const SPEED = 0.5; // m/s cruise
const LANE = 0.35; // keep-right offset from the hall centreline
const ARRIVE = 0.12; // m: close enough to the final waypoint

export const NODES: Record<string, [number, number]> = {
  dock_1: [0, -0.8],
  dock_2: [0, 0.8],
  hall_0: [1, 0],
  hall_p: [2.5, 0],
  pickup: [2.5, -1.3],
  hall_5: [5, 0],
  door_801: [5, 1.3],
  door_802: [5, -1.3],
  fault_point: [6.5, 0],
  hall_8: [8, 0],
  door_803: [8, 1.3],
  door_804: [8, -1.3],
  hall_11: [11, 0],
  door_805: [11, 1.3],
  door_806: [11, -1.3],
};

const EDGES: [string, string][] = [
  ['dock_1', 'hall_0'], ['dock_2', 'hall_0'], ['hall_0', 'hall_p'], ['hall_p', 'pickup'],
  ['hall_p', 'hall_5'], ['hall_5', 'door_801'], ['hall_5', 'door_802'], ['hall_5', 'fault_point'],
  ['fault_point', 'hall_8'], ['hall_8', 'door_803'], ['hall_8', 'door_804'], ['hall_8', 'hall_11'],
  ['hall_11', 'door_805'], ['hall_11', 'door_806'],
];

const ADJ = new Map<string, string[]>();
for (const [a, b] of EDGES) {
  ADJ.set(a, [...(ADJ.get(a) ?? []), b]);
  ADJ.set(b, [...(ADJ.get(b) ?? []), a]);
}

function bfs(a: string, b: string): string[] {
  const prev = new Map<string, string>([[a, a]]);
  const queue = [a];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === b) break;
    for (const m of ADJ.get(n) ?? []) if (!prev.has(m)) { prev.set(m, n); queue.push(m); }
  }
  if (!prev.has(b)) throw new Error(`no route ${a} -> ${b}`);
  const path = [b];
  while (path[0] !== a) path.unshift(prev.get(path[0])!);
  return path;
}

// Node ids from a to b, passing each `via` node in order.
export function route(a: string, b: string, via: string[] = []): string[] {
  const stops = [a, ...via, b];
  const path = [a];
  for (let i = 1; i < stops.length; i++) path.push(...bfs(stops[i - 1], stops[i]).slice(1));
  return path;
}

const isLane = (id: string) => id.startsWith('hall') || id === 'fault_point';

// Node ids → points. Hall nodes shift to the right-hand lane for the
// direction of travel, so robots passing each other in the hall don't meet head-on.
export function waypoints(path: string[]): Point[] {
  return path.map((id, i) => {
    const [x, y] = NODES[id];
    if (!isLane(id)) return { x, y };
    const next = path[i + 1] && isLane(path[i + 1]) ? NODES[path[i + 1]] : null;
    const prev = path[i - 1] && isLane(path[i - 1]) ? NODES[path[i - 1]] : null;
    const dx = next ? next[0] - x : prev ? x - prev[0] : 0;
    return { x, y: dx > 0 ? y - LANE : dx < 0 ? y + LANE : y };
  });
}

export function nearestNode(p: Point): string {
  let best = '';
  let bestD = Infinity;
  for (const [id, [x, y]] of Object.entries(NODES)) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

export function pathLength(from: Point, pts: Point[]): number {
  let total = 0;
  let at = from;
  for (const p of pts) { total += Math.hypot(p.x - at.x, p.y - at.y); at = p; }
  return total;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Steer toward pts[idx]; advance idx once within the lookahead. Turns in
// place when the heading error is large, so tight corners at doors work.
export function pursue(pose: Pose, pts: Point[], idx: number, lookahead = 0.4): { v: number; w: number; idx: number; done: boolean } {
  while (idx < pts.length - 1 && Math.hypot(pts[idx].x - pose.x, pts[idx].y - pose.y) < lookahead) idx++;
  const target = pts[idx];
  const dist = Math.hypot(target.x - pose.x, target.y - pose.y);
  if (idx === pts.length - 1 && dist < ARRIVE) return { v: 0, w: 0, idx, done: true };
  const err = wrap(Math.atan2(target.y - pose.y, target.x - pose.x) - pose.yaw);
  const w = Math.max(-1.5, Math.min(1.5, 2.5 * err));
  const slow = idx === pts.length - 1 ? Math.min(1, dist / 0.5) : 1; // ease into the final stop
  const v = Math.abs(err) > 0.6 ? 0 : SPEED * Math.cos(err) * Math.max(0.3, slow);
  return { v, w, idx, done: false };
}
