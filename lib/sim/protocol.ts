// Messages between the page and lib/sim/sim.worker.ts.
import type { BrainDecision, FleetEvent, FleetSnapshot, LineItem, Option, RobotId } from '../fleet/types.ts';
import type { TaskView } from '../agent/tools.ts';
import type { ApplyResult } from '../fleet/engine.ts';

export type GeomInfo = { name: string; type: number; size: number[]; pos: number[]; rgba: number[] };

export type Request =
  | { kind: 'createTask'; args: { item: string; qty: number; also?: LineItem[]; room: string; callId: string } }
  | { kind: 'getTask'; id: string }
  | { kind: 'cancelTask'; id: string }
  | { kind: 'apply'; decision: BrainDecision }
  | { kind: 'fault'; robotId: RobotId }
  | { kind: 'collect'; taskId: string }
  | { kind: 'binLoaded'; robotId: RobotId }
  | { kind: 'reset' }
  | { kind: 'snapshot' };

export type ToWorker =
  | { type: 'init'; snapshot: FleetSnapshot | null; demo: boolean }
  | { type: 'req'; id: number; req: Request };

export type Reply = { task_id: string; eta_seconds: number } | TaskView | null | boolean | ApplyResult | FleetSnapshot;

// A fleet event plus what the brain is being asked about, if anything.
export type EventWithContext = { event: FleetEvent; context: { taskId: string; options: Option[] } | null };

export type FromWorker =
  | { type: 'static'; geoms: GeomInfo[] }
  | { type: 'frame'; xpos: Float32Array; xmat: Float32Array }
  | { type: 'state'; snapshot: FleetSnapshot }
  | { type: 'events'; events: EventWithContext[]; snapshot: FleetSnapshot }
  | { type: 'res'; id: number; result: Reply }
  | { type: 'error'; message: string };
