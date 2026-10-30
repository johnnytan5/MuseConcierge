import type { BrainEntry } from '@/lib/brain/client.ts';

export default function BrainLog({ entries }: { entries: BrainEntry[] }) {
  return (
    <section className="panel">
      <header><h2>Brain log</h2><span className="muted">Muse Wonder</span></header>
      <ol className="brainlog">
        {entries.map((b) => (
          <li key={b.id} className={b.pending ? 'pending' : b.source}>
            {b.pending ? (
              <span>Thinking about {b.taskId}<span className="dots" /></span>
            ) : (
              <>
                <span>{b.line}</span>
                <small>
                  {new Date(b.at).toLocaleTimeString()} · {b.source === 'model' ? `Muse Wonder ${(b.ms! / 1000).toFixed(1)} s` : `fallback rule${b.error ? ` (${b.error.slice(0, 60)})` : ''}`}
                </small>
              </>
            )}
          </li>
        ))}
        {!entries.length && <li className="muted">No decisions yet</li>}
      </ol>
    </section>
  );
}
