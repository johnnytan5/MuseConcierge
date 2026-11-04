// Shared fleet types: the engine, the brain and the console all speak these.
export type RobotId = 'robot_1' | 'robot_2';
export const ROBOT_IDS: RobotId[] = ['robot_1', 'robot_2'];

export type Pose = { x: number; y: number; yaw: number };
export type Point = { x: number; y: number };

export type Phase =
  | 'docked' | 'to_pickup' | 'loading' | 'to_room' | 'at_room'
  | 'returning' | 'halted' | 'charging';

export type Robot = {
  id: RobotId;
  phase: Phase;
  taskId: string | null;
  battery: number; // percent, 0-100
  fault: boolean; // battery fault: robot must charge before it works again
  pose: Pose;
  path: Point[]; // waypoints of the current leg
  wp: number; // index of the waypoint being steered toward
  until: number; // clock ms when a timed phase (loading, at_room, charging) ends
};

export type TaskStatus = 'queued' | 'assigned' | 'en_route' | 'reassigned' | 'at_door' | 'delivered' | 'not_collected' | 'cancelled';

export type LineItem = { item: string; qty: number };

export type Task = {
  id: string;
  kind: 'guest' | 'housekeeping';
  priority: 'high' | 'low';
  item: string;
  qty: number;
  also?: LineItem[]; // more items for the same room, in the same cabin
  room: string;
  callId: string | null;
  status: TaskStatus;
  robotId: RobotId | null;
  etaAt: number | null; // clock ms the item is expected at the door
  createdAt: number;
  arrivedAt?: number; // reached the door; deliveredAt is when the guest collected
  deliveredAt: number | null;
  history: { at: number; status: string; robotId: RobotId | null }[];
};

export type FleetSnapshot = {
  now: number;
  seq: number;
  faultFired: boolean; // demo mode fires the battery fault once per reset
  robots: Robot[];
  tasks: Task[];
};

export type FleetEvent =
  | { type: 'task_created'; taskId: string }
  | { type: 'battery_fault'; robotId: RobotId; taskId: string; battery: number }
  | { type: 'robot_idle'; robotId: RobotId }
  | { type: 'arrived'; taskId: string; robotId: RobotId }
  | { type: 'delivered'; taskId: string; robotId: RobotId }
  | { type: 'not_collected'; taskId: string; robotId: RobotId };

// What the engine offers the brain. ETAs are the engine's, never the model's.
export type Option =
  | { action: 'assign'; robot: RobotId; eta_s: number }
  | { action: 'continue'; eta_s: number; feasible: boolean; why?: string }
  | { action: 'charge_then_continue'; eta_s: number }
  | { action: 'handoff'; to: RobotId; eta_s: number; preempts: string | null }
  | { action: 'wait' };

export type BrainDecision =
  | { assign: string; to: RobotId; reason: string }
  | { handoff: string; to: RobotId; preempt: string | null; reason: string }
  | { charge_then_continue: string; reason: string }
  | { continue: string; reason: string }
  | { wait: string; reason: string };

export interface SimPort {
  pose(r: RobotId): Pose;
  drive(r: RobotId, v: number, w: number): void;
  lid(r: RobotId, open: boolean): void;
  teleport(r: RobotId, p: Pose): void;
}

export const lineItems = (t: Pick<Task, 'item' | 'qty' | 'also'>): LineItem[] => [{ item: t.item, qty: t.qty }, ...(t.also ?? [])];
