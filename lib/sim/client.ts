// Page-side handle on the sim worker. Implements FleetApi, so a call
// session's tools go straight to the engine in the worker.
import type { FleetApi, TaskView } from '../agent/tools.ts';
import type { BrainDecision, FleetSnapshot, LineItem, RobotId } from '../fleet/types.ts';
import type { ApplyResult } from '../fleet/engine.ts';
import type { EventWithContext, FromWorker, GeomInfo, Reply, Request } from './protocol.ts';

export type FleetListeners = {
  onStatic?(geoms: GeomInfo[]): void;
  onFrame?(xpos: Float32Array, xmat: Float32Array): void;
  onState?(s: FleetSnapshot): void;
  onEvents?(events: EventWithContext[], snapshot: FleetSnapshot): void;
  onError?(message: string): void;
};

export class FleetClient implements FleetApi {
  worker: Worker;
  subs = new Set<FleetListeners>();
  geoms: GeomInfo[] | null = null; // replayed to late subscribers
  pending = new Map<number, (r: Reply) => void>();
  nextId = 1;

  constructor(opts: { snapshot: FleetSnapshot | null; demo: boolean }) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === 'res') { this.pending.get(m.id)?.(m.result); this.pending.delete(m.id); return; }
      if (m.type === 'static') this.geoms = m.geoms;
      for (const l of this.subs) {
        if (m.type === 'static') l.onStatic?.(m.geoms);
        else if (m.type === 'frame') l.onFrame?.(m.xpos, m.xmat);
        else if (m.type === 'state') l.onState?.(m.snapshot);
        else if (m.type === 'events') l.onEvents?.(m.events, m.snapshot);
        else if (m.type === 'error') l.onError?.(m.message);
      }
    };
    this.worker.postMessage({ type: 'init', snapshot: opts.snapshot, demo: opts.demo });
  }

  subscribe(l: FleetListeners): () => void {
    this.subs.add(l);
    if (this.geoms) l.onStatic?.(this.geoms);
    return () => { this.subs.delete(l); };
  }

  request<T extends Reply>(req: Request): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve as (r: Reply) => void);
      this.worker.postMessage({ type: 'req', id, req });
    });
  }

  createTask(args: { item: string; qty: number; also?: LineItem[]; room: string; callId: string }) {
    return this.request<{ task_id: string; eta_seconds: number }>({ kind: 'createTask', args });
  }
  getTask(id: string) { return this.request<TaskView | null>({ kind: 'getTask', id }); }
  cancelTask(id: string) { return this.request<boolean>({ kind: 'cancelTask', id }); }
  apply(decision: BrainDecision) { return this.request<ApplyResult>({ kind: 'apply', decision }); }
  fault(robotId: RobotId) { return this.request<boolean>({ kind: 'fault', robotId }); }
  collect(taskId: string) { return this.request<boolean>({ kind: 'collect', taskId }); }
  reset() { return this.request<boolean>({ kind: 'reset' }); }
  getSnapshot() { return this.request<FleetSnapshot>({ kind: 'snapshot' }); }

  terminate() { this.worker.terminate(); }
}
