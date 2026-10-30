// Page side of the brain: one /api/brain call per fleet question, the
// decision applied in the engine, and a log entry for the console. If the
// engine rejects the model's pick (the fleet moved on meanwhile), the
// fastest option still valid is applied instead.
import type { FleetClient } from '../sim/client.ts';
import type { EventWithContext } from '../sim/protocol.ts';
import type { BrainDecision, FleetEvent, FleetSnapshot } from '../fleet/types.ts';
import { fallbackDecision, decisionFor } from './decide.ts';

// Same option, ignoring the free-text reason.
const sameChoice = (a: BrainDecision, b: BrainDecision) => JSON.stringify({ ...a, reason: '' }) === JSON.stringify({ ...b, reason: '' });
import { describe } from './describe.ts';
import { optionsFor } from '../fleet/options.ts';
import { notification, type RoomNotification } from '../fleet/notify.ts';

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
  etaS?: number; // ETA of the chosen option
  notify?: RoomNotification | null;
};

let nextId = 1;

export async function decide(
  fleet: FleetClient,
  { event, context }: EventWithContext,
  snapshot: FleetSnapshot,
  update: (e: BrainEntry) => void,
  callId: string | null,
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
      body: JSON.stringify({ event, taskId: context.taskId, options: context.options, snapshot, callId }),
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
  const chosen = context.options.find((o) => decisionFor(context.taskId, o, '') && sameChoice(decisionFor(context.taskId, o, ''), decision));
  const etaS = chosen && 'eta_s' in chosen ? chosen.eta_s : undefined;
  const task = snapshot.tasks.find((t) => t.id === context.taskId);
  update({
    ...entry, pending: false, decision, source, ms, error, etaS,
    line: describe(event, decision, etaS),
    notify: task ? notification(event, decision, task, etaS) : null,
  });
}
