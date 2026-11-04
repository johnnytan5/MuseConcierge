// The fleet task engine: task queue, robot phases, battery, and execution of
// brain decisions. Pure logic: physics comes in through SimPort, time through
// the clock, so tests drive it with a kinematic fake.
import { route, waypoints, nearestNode, pursue, NODES, SPEED, FLOOR_VERSION, DOCK_YAW, doorFacingYaw, turnTo } from './nav.ts';
import { optionsFor, dockOf, doorOf, distance, LOAD_S, GUEST_DWELL_S, COLLECT_TIMEOUT_S, HK_DWELL_S, CHARGE_S, DRAIN_PER_M } from './options.ts';
import { ROBOT_IDS } from './types.ts';
import type { BrainDecision, FleetEvent, FleetSnapshot, LineItem, Robot, RobotId, SimPort, Task, TaskStatus } from './types.ts';
import type { FleetApi, TaskView } from '../agent/tools.ts';

const START_BATTERY: Record<RobotId, number> = { robot_1: 64, robot_2: 82 };
const FAULT_RADIUS = 0.5; // m around fault_point where demo mode fires the fault
const YIELD_DIST = 0.6; // m: stop if another robot is this close ahead
const YIELD_CONE = 1.0; // rad either side of the heading that counts as "ahead"
const PASS_CLEAR = 0.36; // m: side-on distance at which two robots clear each other
const PICKUP_CLEAR = 0.45; // m: a robot this close to the pickup still occupies it
const MOVING = new Set(['to_pickup', 'to_room', 'returning']);

export type ApplyResult = { ok: true } | { ok: false; error: string };

export class Fleet implements FleetApi {
  clock: () => number;
  demoFault: boolean;
  collection: boolean; // guest orders wait at the door for collect(); off, they complete on arrival
  robots: Robot[];
  tasks: Task[] = [];
  seq = 0;
  faultFired = false;
  events: FleetEvent[] = [];

  constructor(clock: () => number, opts: { demoFault?: boolean; collection?: boolean } = {}) {
    this.clock = clock;
    this.demoFault = !!opts.demoFault;
    this.collection = !!opts.collection;
    this.robots = ROBOT_IDS.map((id) => {
      const [x, y] = NODES[dockOf(id)];
      return { id, phase: 'docked', taskId: null, battery: START_BATTERY[id], fault: false, pose: { x, y, yaw: 0 }, path: [], wp: 0, until: 0 };
    });
  }

  static restore(s: FleetSnapshot, clock: () => number, opts: { demoFault?: boolean; collection?: boolean } = {}): Fleet {
    const f = new Fleet(clock, opts);
    f.seq = s.seq;
    f.faultFired = s.faultFired;
    f.robots = structuredClone(s.robots);
    f.tasks = structuredClone(s.tasks);
    return f;
  }

  snapshot(): FleetSnapshot {
    return structuredClone({ now: this.clock(), seq: this.seq, faultFired: this.faultFired, floor: FLOOR_VERSION, robots: this.robots, tasks: this.tasks });
  }

  drain(): FleetEvent[] {
    return this.events.splice(0);
  }

  // The demo opening: robot 2 is already out on a housekeeping drop to 1205.
  seedDemo(): void {
    const hk = this.newTask({ kind: 'housekeeping', priority: 'low', item: 'linen', qty: 1, room: '1205', callId: null });
    const r = this.robot('robot_2');
    this.start(r, hk, 'assigned', Math.round(distance(r.pose, doorOf(hk.room), ['pickup']) / SPEED + LOAD_S));
  }

  // ---- FleetApi (call-agent tools) -------------------------------------

  createTask(i: { item: string; qty: number; also?: LineItem[]; room: string; callId: string }): { task_id: string; eta_seconds: number } {
    const t = this.newTask({ kind: 'guest', priority: 'high', ...i });
    this.events.push({ type: 'task_created', taskId: t.id });
    // Quote the best case now; the brain's decision sets the real ETA.
    const etas = optionsFor(t.id, this.snapshotView()).flatMap((o) => (o.action === 'assign' ? [o.eta_s] : []));
    return { task_id: t.id, eta_seconds: etas.length ? Math.min(...etas) : 180 };
  }

  getTask(id: string): TaskView | null {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return null;
    return {
      task_id: t.id, status: t.status, room: t.room, item: t.item, qty: t.qty, also: t.also, robot: t.robotId,
      eta_seconds: t.etaAt && t.status !== 'delivered' && t.status !== 'at_door' ? Math.max(0, Math.round((t.etaAt - this.clock()) / 1000)) : 0,
    };
  }

  cancelTask(id: string): boolean {
    const t = this.tasks.find((x) => x.id === id);
    if (!t || t.status === 'delivered' || t.status === 'cancelled' || t.status === 'not_collected') return false;
    this.setStatus(t, 'cancelled');
    const r = t.robotId ? this.robot(t.robotId) : null;
    if (r && r.taskId === t.id) {
      r.taskId = null;
      if (r.phase !== 'docked' && r.phase !== 'charging') this.goHome(r);
    }
    return true;
  }

  // ---- Brain decisions ---------------------------------------------------

  apply(d: BrainDecision): ApplyResult {
    const taskId = 'assign' in d ? d.assign : 'handoff' in d ? d.handoff
      : 'charge_then_continue' in d ? d.charge_then_continue : 'continue' in d ? d.continue : d.wait;
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) return { ok: false, error: `unknown task ${taskId}` };
    const opts = optionsFor(taskId, this.snapshotView());

    if ('assign' in d) {
      const o = opts.find((x) => x.action === 'assign' && x.robot === d.to);
      if (!o || o.action !== 'assign') return { ok: false, error: `cannot assign ${taskId} to ${d.to}` };
      this.start(this.robot(d.to), t, 'assigned', o.eta_s);
      return { ok: true };
    }
    if ('handoff' in d) {
      const o = opts.find((x) => x.action === 'handoff' && x.to === d.to && x.preempts === (d.preempt ?? null));
      if (!o || o.action !== 'handoff') return { ok: false, error: `no handoff of ${taskId} to ${d.to}` };
      const from = this.robot(t.robotId!);
      from.taskId = null;
      this.goHome(from);
      const to = this.robot(d.to);
      if (to.taskId) {
        const bumped = this.tasks.find((x) => x.id === to.taskId)!;
        bumped.robotId = null;
        this.setStatus(bumped, 'queued');
      }
      this.start(to, t, 'reassigned', o.eta_s);
      return { ok: true };
    }
    if ('charge_then_continue' in d) {
      const o = opts.find((x) => x.action === 'charge_then_continue');
      if (!o || o.action !== 'charge_then_continue') return { ok: false, error: `cannot charge for ${taskId}` };
      this.goHome(this.robot(t.robotId!)); // keeps the task: it resumes after charging
      t.etaAt = this.clock() + o.eta_s * 1000;
      t.history.push({ at: this.clock(), status: 'charging', robotId: t.robotId });
      return { ok: true };
    }
    if ('continue' in d) {
      const o = opts.find((x) => x.action === 'continue');
      if (!o || o.action !== 'continue' || !o.feasible) return { ok: false, error: `${taskId} cannot continue` };
      const r = this.robot(t.robotId!);
      r.fault = false;
      r.phase = 'to_room';
      this.setPath(r, doorOf(t.room));
      t.etaAt = this.clock() + o.eta_s * 1000;
      return { ok: true };
    }
    if (!opts.some((x) => x.action === 'wait')) return { ok: false, error: `${taskId} cannot wait` };
    return { ok: true };
  }

  // The guest took their items: the robot closes up and leaves after a moment.
  collect(taskId: string): boolean {
    const t = this.tasks.find((x) => x.id === taskId);
    const r = t?.robotId ? this.robot(t.robotId) : null;
    if (!t || !r || t.status !== 'at_door' || r.taskId !== t.id) return false;
    this.deliver(t, r);
    r.until = this.clock() + GUEST_DWELL_S * 1000;
    return true;
  }

  injectBatteryFault(id: RobotId, to = 9): boolean {
    const r = this.robot(id);
    if (!r.taskId || r.fault || !(MOVING.has(r.phase) || r.phase === 'loading')) return false;
    r.battery = Math.min(r.battery, to);
    r.fault = true;
    r.phase = 'halted';
    this.events.push({ type: 'battery_fault', robotId: r.id, taskId: r.taskId, battery: r.battery });
    return true;
  }

  // ---- Simulation step -----------------------------------------------------

  tick(_dt: number, sim: SimPort): void {
    const now = this.clock();
    for (const r of this.robots) {
      const p = sim.pose(r.id);
      if (MOVING.has(r.phase)) r.battery = Math.max(0, r.battery - Math.hypot(p.x - r.pose.x, p.y - r.pose.y) * DRAIN_PER_M);
      r.pose = p;
      const atStop = r.phase === 'at_room' || r.phase === 'loading';
      sim.lid(r.id, atStop);

      if (MOVING.has(r.phase) && this.mustWait(r)) {
        sim.drive(r.id, 0, 0);
      } else if (MOVING.has(r.phase)) {
        const c = pursue(p, r.path, r.wp);
        r.wp = c.idx;
        sim.drive(r.id, c.v, c.w);
        if (c.done) this.arrive(r);
      } else {
        const parked = r.phase === 'docked' || r.phase === 'charging';
        sim.drive(r.id, 0, atStop ? turnTo(p.yaw, doorFacingYaw(p)) : parked ? turnTo(p.yaw, DOCK_YAW) : 0);
        if (r.until && now >= r.until) this.timerDone(r);
      }
      this.maybeDemoFault(r);
    }
  }

  // ---- internals -----------------------------------------------------------

  arrive(r: Robot): void {
    const t = r.taskId ? this.tasks.find((x) => x.id === r.taskId)! : null;
    if (r.phase === 'to_pickup') {
      this.wait(r, 'loading', LOAD_S);
    } else if (r.phase === 'to_room' && t) {
      if (t.kind === 'housekeeping') this.wait(r, 'at_room', HK_DWELL_S);
      else if (!this.collection) {
        this.wait(r, 'at_room', GUEST_DWELL_S);
        this.deliver(t, r);
      } else {
        this.wait(r, 'at_room', COLLECT_TIMEOUT_S);
        t.arrivedAt = this.clock();
        this.setStatus(t, 'at_door');
        this.events.push({ type: 'arrived', taskId: t.id, robotId: r.id });
      }
    } else if (r.phase === 'returning') {
      if (r.fault) this.wait(r, 'charging', CHARGE_S);
      else this.dock(r);
    }
  }

  timerDone(r: Robot): void {
    const t = r.taskId ? this.tasks.find((x) => x.id === r.taskId) : undefined;
    r.until = 0;
    if (r.phase === 'loading' && t) {
      this.setStatus(t, 'en_route');
      r.phase = 'to_room';
      this.setPath(r, doorOf(t.room));
    } else if (r.phase === 'at_room') {
      if (t && t.kind === 'housekeeping') this.deliver(t, r);
      if (t?.status === 'at_door') {
        this.setStatus(t, 'not_collected');
        this.events.push({ type: 'not_collected', taskId: t.id, robotId: r.id });
      }
      r.taskId = null;
      this.goHome(r);
    } else if (r.phase === 'charging') {
      r.battery = 100;
      r.fault = false;
      if (t) {
        r.phase = 'to_room';
        this.setPath(r, doorOf(t.room));
      } else this.dock(r);
    }
  }

  // Two simple traffic rules instead of a planner: one robot at the pickup
  // at a time (the closer one goes first), and stop for a robot close ahead
  // (if both block each other, robot_1 has right of way).
  mustWait(r: Robot): boolean {
    const [px, py] = NODES.pickup;
    const toPickup = (q: Robot) => Math.hypot(q.pose.x - px, q.pose.y - py);
    for (const o of this.robots) {
      if (o.id === r.id) continue;
      if (r.phase === 'to_pickup' && r.wp >= r.path.length - 2) {
        const occupied = o.phase === 'loading'
          || (o.phase === 'to_pickup' && o.wp >= o.path.length - 2 && (toPickup(o) < toPickup(r) || (toPickup(o) === toPickup(r) && o.id < r.id)))
          || (o.phase !== 'to_pickup' && toPickup(o) < PICKUP_CLEAR);
        if (occupied) return true;
      }
      if (this.blocks(r, o) && !(this.blocks(o, r) && r.id === 'robot_1')) return true;
    }
    return false;
  }

  // Is o close and roughly where r is going? (Its next waypoint, not its
  // heading: a robot turned towards the desk isn't driving that way.)
  blocks(r: Robot, o: Robot): boolean {
    const dx = o.pose.x - r.pose.x;
    const dy = o.pose.y - r.pose.y;
    if (Math.hypot(dx, dy) > YIELD_DIST) return false;
    const to = r.path[r.wp];
    if (!to) return false;
    const heading = Math.atan2(to.y - r.pose.y, to.x - r.pose.x);
    // A parked robot only blocks if r would actually hit it; waiting for one
    // beside the route would wait forever.
    if (!MOVING.has(o.phase)) {
      const ahead = dx * Math.cos(heading) + dy * Math.sin(heading);
      const beside = Math.abs(-dx * Math.sin(heading) + dy * Math.cos(heading));
      return ahead > 0 && beside < PASS_CLEAR;
    }
    const ang = Math.atan2(dy, dx) - heading;
    return Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) < YIELD_CONE;
  }

  maybeDemoFault(r: Robot): void {
    if (!this.demoFault || this.faultFired || r.id !== 'robot_1' || r.phase !== 'to_room') return;
    const t = this.tasks.find((x) => x.id === r.taskId);
    if (t?.kind !== 'guest') return;
    // Mid-corridor, or a metre short of the door for rooms before that point.
    const [fx, fy] = NODES.fault_point;
    const at = Math.min(fx, NODES[doorOf(t.room)][0] - 1);
    if (r.pose.x > 0 && Math.hypot(r.pose.x - at, r.pose.y - fy) < FAULT_RADIUS) {
      this.faultFired = this.injectBatteryFault(r.id);
    }
  }

  start(r: Robot, t: Task, status: TaskStatus, etaS: number): void {
    r.taskId = t.id;
    t.robotId = r.id;
    t.etaAt = this.clock() + etaS * 1000;
    this.setStatus(t, status);
    r.phase = 'to_pickup';
    r.until = 0;
    this.setPath(r, 'pickup');
  }

  deliver(t: Task, r: Robot): void {
    t.deliveredAt = this.clock();
    this.setStatus(t, 'delivered');
    this.events.push({ type: 'delivered', taskId: t.id, robotId: r.id });
  }

  dock(r: Robot): void {
    r.phase = 'docked';
    if (!r.taskId) this.events.push({ type: 'robot_idle', robotId: r.id });
  }

  goHome(r: Robot): void {
    r.phase = 'returning';
    r.until = 0;
    this.setPath(r, dockOf(r.id));
  }

  wait(r: Robot, phase: Robot['phase'], seconds: number): void {
    r.phase = phase;
    r.until = this.clock() + seconds * 1000;
  }

  setPath(r: Robot, to: string): void {
    r.path = waypoints(route(nearestNode(r.pose), to));
    r.wp = 0;
  }

  setStatus(t: Task, status: TaskStatus): void {
    t.status = status;
    t.history.push({ at: this.clock(), status, robotId: t.robotId });
  }

  newTask(i: Pick<Task, 'kind' | 'priority' | 'item' | 'qty' | 'also' | 'room' | 'callId'>): Task {
    // t1, t2… for guest orders and hk1, hk2… for housekeeping read better on screen.
    const prefix = i.kind === 'guest' ? 't' : 'hk';
    this.seq++;
    const t: Task = {
      ...i, id: `${prefix}${this.tasks.filter((x) => x.kind === i.kind).length + 1}`, status: 'queued', robotId: null, etaAt: null,
      createdAt: this.clock(), deliveredAt: null, history: [],
    };
    this.setStatus(t, 'queued');
    this.tasks.push(t);
    return t;
  }

  robot(id: RobotId): Robot {
    return this.robots.find((r) => r.id === id)!;
  }

  // Live view for option checks: no copy, read-only use.
  snapshotView(): FleetSnapshot {
    return { now: this.clock(), seq: this.seq, faultFired: this.faultFired, robots: this.robots, tasks: this.tasks };
  }
}
