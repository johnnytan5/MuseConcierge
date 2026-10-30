// Page side of the brain: one /api/brain call per fleet question, the
// decision applied in the engine, and a log entry for the console. If the
// engine rejects the model's pick (the fleet moved on meanwhile), the
// fastest option still valid is applied instead.
import type { FleetClient } from '../sim/client.ts';
import type { EventWithContext } from '../sim/protocol.ts';
import type { BrainDecision, FleetEvent, FleetSnapshot } from '../fleet/types.ts';
import { fallbackDecision } from './decide.ts';
import { describe } from './describe.ts';
import { optionsFor } from '../fleet/options.ts';

export type BrainEntry = {
  id: number;
  at: number;
  event: FleetEvent;
  taskId: string;
  pending: boolean;
  decision?: BrainDecision;
  source?: 'model' | 'fallback';
  ms?: number;
  line?: string;
  error?: string;
};

let nextId = 1;

export async function decide(
  fleet: FleetClient,
  { event, context }: EventWithContext,
  snapshot: FleetSnapshot,
  update: (e: BrainEntry) => void,
): Promise<void> {
  if (!context) return;
  const entry: BrainEntry = { id: nextId++, at: Date.now(), event, taskId: context.taskId, pending: true };
  update({ ...entry });
  let decision: BrainDecision;
  let source: 'model' | 'fallback' = 'fallback';
  let ms = 0;
  let error: string | undefined;
  try {
    const res = await fetch('/api/brain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, taskId: context.taskId, options: context.options, snapshot }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `brain ${res.status}`);
    ({ decision, source, ms } = body);
    error = body.error;
  } catch (e) {
    decision = fallbackDecision(context.taskId, context.options);
    error = e instanceof Error ? e.message : String(e);
  }

  let result = await fleet.apply(decision);
  if (!result.ok) {
    const fresh = await fleet.getSnapshot();
    decision = fallbackDecision(context.taskId, optionsFor(context.taskId, fresh));
    source = 'fallback';
    error = result.error;
    result = await fleet.apply(decision);
  }
  const opt = context.options.find((o) => o.action === 'charge_then_continue');
  update({
    ...entry, pending: false, decision, source, ms, error,
    line: describe(event, decision, opt && 'eta_s' in opt ? opt.eta_s : undefined),
  });
}
