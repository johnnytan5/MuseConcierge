// One hotel floor as a waypoint graph, plus pure-pursuit steering. The MJCF
// scene in public/sim/floor.xml is laid out on the same coordinates (metres).
import type { Point, Pose } from './types.ts';

// Saved runs hold robot poses and rooms, so a run from another floor plan is discarded.
export const FLOOR_VERSION = 6;

export const SPEED = 0.5; // m/s cruise
const LANE = 0.25; // keep-right offset from the hall centreline
const ARRIVE = 0.04; // m: close enough to the final waypoint
const WAYPOINT_REACH = 0.1; // m: close enough to a waypoint on the way
const SLOW_DIST = 0.35; // m before a turn or stop where the robot starts slowing
const TURN_ON_SPOT = 0.35; // rad of heading error above which it stops and turns

export const NODES: Record<string, [number, number]> = {
  dock_1: [-0.62, -0.58],
  dock_2: [-0.62, 0.58],
  pickup: [-0.8, 0],
  // Each dock has its own way in, clear of the lobby wall's corners and of a
  // robot leaving the desk.
  lobby_s: [-0.25, -0.4],
  lobby_n: [-0.25, 0.4],
  hall_0: [0.1, 0],
  fault_point: [1.4, 0],
  hall_803: [1, 0],
  door_803: [1, -0.1],
  hall_804: [2, 0],
  door_804: [2, 0.1],
  hall_j: [3, 0],
  hall_1204: [3, 1],
  door_1204: [3.1, 1],
  hall_1205: [3, 2],
  door_1205: [2.9, 2],
};

const EDGES: [string, string][] = [
  ['dock_1', 'pickup'], ['dock_2', 'pickup'], ['dock_1', 'lobby_s'], ['dock_2', 'lobby_n'], ['lobby_s', 'hall_0'], ['lobby_n', 'hall_0'], ['pickup', 'hall_0'],
  ['hall_0', 'hall_803'], ['hall_803', 'door_803'], ['hall_803', 'fault_point'], ['fault_point', 'hall_804'],
  ['hall_804', 'door_804'], ['hall_804', 'hall_j'], ['hall_j', 'hall_1204'], ['hall_1204', 'door_1204'],
  ['hall_1204', 'hall_1205'], ['hall_1205', 'door_1205'],
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
    // The right of travel, for each hall segment touching this node. On a
    // corner the two offsets combine: that is where the two lanes cross.
    const right = (ax: number, ay: number): [number, number] => {
      const len = Math.hypot(ax, ay) || 1;
      return [ay / len, -ax / len];
    };
    const out = next && right(next[0] - x, next[1] - y);
    const inn = prev && right(x - prev[0], y - prev[1]);
    const a = out ?? inn ?? [0, 0];
    const b = out && inn && Math.abs(out[0] * inn[0] + out[1] * inn[1]) < 0.5 ? inn : [0, 0];
    return { x: x + (a[0] + b[0]) * LANE, y: y + (a[1] + b[1]) * LANE };
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

// Steer along the waypoints without cutting corners: the corridor leaves about
// 0.15 m each side, so the robot reaches each waypoint, slowing for a turn, and
// turns on the spot before driving the next leg.
export function pursue(pose: Pose, pts: Point[], idx: number, reach = WAYPOINT_REACH): { v: number; w: number; idx: number; done: boolean } {
  while (idx < pts.length - 1 && Math.hypot(pts[idx].x - pose.x, pts[idx].y - pose.y) < reach) idx++;
  const target = pts[idx];
  const dist = Math.hypot(target.x - pose.x, target.y - pose.y);
  if (idx === pts.length - 1 && dist < ARRIVE) return { v: 0, w: 0, idx, done: true };
  const err = wrap(Math.atan2(target.y - pose.y, target.x - pose.x) - pose.yaw);
  const w = Math.max(-1.5, Math.min(1.5, 2.5 * err));
  const next = pts[idx + 1];
  const turnAhead = !next || Math.abs(wrap(Math.atan2(next.y - target.y, next.x - target.x) - Math.atan2(target.y - pose.y, target.x - pose.x))) > 0.3;
  const slow = turnAhead ? Math.min(1, dist / SLOW_DIST) : 1;
  const v = Math.abs(err) > TURN_ON_SPOT ? 0 : SPEED * Math.cos(err) * Math.max(0.25, slow);
  return { v, w, idx, done: false };
}

// Where each stop's cabin door should open towards: the room's door, or the
// front desk across the counter.
export const DOOR_FACES: Record<string, [number, number]> = {
  pickup: [-1, 0],
  door_803: [0, -1],
  door_804: [0, 1],
  door_1204: [1, 0],
  door_1205: [-1, 0],
};

// The cabin door is on the robot's -y side, so to open it along (ux, uy) the
// robot turns so that (sin yaw, -cos yaw) points that way.
export function doorFacingYaw(p: Point): number {
  let best = DOOR_FACES.pickup;
  let bestD = Infinity;
  for (const [id, face] of Object.entries(DOOR_FACES)) {
    const d = Math.hypot(p.x - NODES[id][0], p.y - NODES[id][1]);
    if (d < bestD) { bestD = d; best = face; }
  }
  return Math.atan2(best[0], -best[1]);
}

export function turnTo(yaw: number, target: number): number {
  return Math.max(-1.5, Math.min(1.5, 2.5 * wrap(target - yaw)));
}

export const DOCK_YAW = 0; // docked robots square up to the pad, screen towards the hall
