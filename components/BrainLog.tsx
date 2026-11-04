import type { BrainEntry } from '@/lib/brain/client.ts';
import { optionLabel } from '@/lib/brain/describe.ts';

// One decision: what happened, every option the engine offered with its ETA,
// the one Muse Wonder picked and why, and what that sets in motion.
export function BrainCard({ b }: { b: BrainEntry }) {
  const reason = b.decision && 'reason' in b.decision ? b.decision.reason : '';
  return (
    <>
      <span className="brainhead">{b.pending ? <>Weighing {b.options.length === 1 ? 'the option' : `${b.options.length} options`} for {b.taskId}<span className="dots" /></> : b.line?.split(' (')[0]}</span>
      {b.options.length > 1 && (
        <ul className="options">
          {b.options.map((o, i) => {
            const { text, eta } = optionLabel(o);
            return (
              <li key={i} className={!b.pending && i === b.chosen ? 'chosen' : eta === 'no' ? 'ruled-out' : ''}>
                <span>{text}</span><span>{eta === 'no' ? '' : eta}</span>
              </li>
            );
          })}
        </ul>
      )}
      {!b.pending && reason && <span className="why">“{reason}”</span>}
      {!b.pending && b.options.length > 1 && !!b.steps?.length && (
        <ol className="steps">{b.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      )}
      {!b.pending && (
        <small>
          {new Date(b.at).toLocaleTimeString()} · {b.source === 'model' ? `Muse Wonder ${(b.ms! / 1000).toFixed(1)} s` : `fallback rule${b.error ? ` (${b.error.slice(0, 60)})` : ''}`}
        </small>
      )}
    </>
  );
}

export default function BrainLog({ entries }: { entries: BrainEntry[] }) {
  return (
    <section className="panel">
      <header><h2>Brain log</h2><span className="muted">Muse Wonder</span></header>
      <ol className="brainlog">
        {entries.map((b) => <li key={b.id} className={b.pending ? 'pending' : b.source}><BrainCard b={b} /></li>)}
        {!entries.length && <li className="muted">No decisions yet</li>}
      </ol>
    </section>
  );
}
