// The choices open to the brain for one task, each with an engine-computed
// ETA. The brain picks; it never invents a route or a time.
import { route, waypoints, nearestNode, pathLength, SPEED } from './nav.ts';
import type { FleetEvent, FleetSnapshot, Option, Point, RobotId, Task } from './types.ts';

export const LOAD_S = 4; // staff load the cabin at the pickup station
export const GUEST_DWELL_S = 6; // cabin door stays open after the guest has their items
export const COLLECT_TIMEOUT_S = 120; // robot gives up and goes home if nobody collects
export const HK_DWELL_S = 120; // housekeeping drop: robot waits while the room is serviced
export const CHARGE_S = 600;
export const DRAIN_PER_M = 0.4; // battery % per metre driven
export const RESERVE = 10; // % a robot must still have when it gets home

export const dockOf = (r: RobotId) => (r === 'robot_1' ? 'dock_1' : 'dock_2');
export const doorOf = (room: string) => `door_${room}`;

// Metres from p along the graph to `to`, passing `via`.
export function distance(p: Point, to: string, via: string[] = []): number {
  return pathLength(p, waypoints(route(nearestNode(p), to, via)));
}

const nodePoint = (id: string): Point => {
  const pts = waypoints([id]);
  return pts[0];
};

// Battery a robot at p needs to take an item to the room and get home.
const tripNeed = (p: Point, task: Task, r: RobotId, via: string[]) =>
  (distance(p, doorOf(task.room), via) + distance(nodePoint(doorOf(task.room)), dockOf(r))) * DRAIN_PER_M + RESERVE;

export function optionsFor(taskId: string, s: FleetSnapshot): Option[] {
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task || task.status === 'delivered' || task.status === 'cancelled' || task.status === 'not_collected' || task.status === 'at_door') return [];
  const byId = new Map(s.robots.map((r) => [r.id, r]));

  if (task.status === 'queued') {
    const opts: Option[] = s.robots
      .filter((r) => r.phase === 'docked' && !r.fault && r.taskId === null && r.battery >= tripNeed(r.pose, task, r.id, ['pickup']))
      .map((r) => ({ action: 'assign', robot: r.id, eta_s: Math.round(distance(r.pose, doorOf(task.room), ['pickup']) / SPEED + LOAD_S) }));
    return opts.length ? opts : [{ action: 'wait' }];
  }

  const carrier = task.robotId ? byId.get(task.robotId) : undefined;
  if (!carrier?.fault || carrier.phase !== 'halted') return [];

  const opts: Option[] = [];
  const need = Math.ceil(tripNeed(carrier.pose, task, carrier.id, []));
  opts.push({
    action: 'continue',
    eta_s: Math.round(distance(carrier.pose, doorOf(task.room)) / SPEED),
    feasible: carrier.battery >= need,
    ...(carrier.battery < need ? { why: `needs ${need}%, has ${Math.floor(carrier.battery)}%` } : {}),
  });
  opts.push({
    action: 'charge_then_continue',
    eta_s: Math.round((distance(carrier.pose, dockOf(carrier.id)) + distance(nodePoint(dockOf(carrier.id)), doorOf(task.room))) / SPEED + CHARGE_S),
  });
  for (const other of s.robots) {
    if (other.id === carrier.id || other.fault) continue;
    const current = other.taskId ? s.tasks.find((t) => t.id === other.taskId) : undefined;
    if (current && current.priority !== 'low') continue; // never bump another guest's order
    if (other.battery < tripNeed(other.pose, task, other.id, ['pickup'])) continue;
    opts.push({
      action: 'handoff',
      to: other.id,
      eta_s: Math.round(distance(other.pose, doorOf(task.room), ['pickup']) / SPEED + LOAD_S),
      preempts: current?.id ?? null,
    });
  }
  return opts;
}


// Which task an event asks the brain about, with its options. A robot going
// idle is a question about the most urgent queued task.
export function decisionContext(e: FleetEvent, s: FleetSnapshot): { taskId: string; options: Option[] } | null {
  let taskId: string | undefined;
  if (e.type === 'task_created' || e.type === 'battery_fault') taskId = e.taskId;
  else if (e.type === 'robot_idle') {
    taskId = s.tasks
      .filter((t) => t.status === 'queued')
      .sort((a, b) => (a.priority === b.priority ? a.createdAt - b.createdAt : a.priority === 'high' ? -1 : 1))[0]?.id;
  }
  if (!taskId) return null;
  const options = optionsFor(taskId, s);
  return options.length ? { taskId, options } : null;
}
