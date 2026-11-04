'use client';

// Every guest call: who said what, every tool call with its arguments and
// result, and what the fleet did for that call, in the order it happened.
import { useMemo, useState } from 'react';
import type { Records, Session, ToolEvent, Turn } from './useRecords.ts';

const NAMES: Record<string, string> = {
  create_task: 'Created a delivery', dispatch_delivery: 'Sent a delivery', get_task_status: 'Checked a delivery', check_delivery_status: 'Checked a delivery',
  cancel_task: 'Cancelled a delivery', escalate_to_frontdesk: 'Escalated to front desk', end_call: 'Ended the call',
  brain_decision: 'Brain decision', door_check: 'Door check', cabin_check: 'Cabin check', collection: 'Guest collected',
};
const nameOf = (t: string) => NAMES[t] ?? t.replace(/_/g, ' ');
const time = (iso: string) => new Date(iso).toLocaleTimeString();
const FIRST_LINE = 'Room service, how can I help?';

type Line = { at: string; turn?: Turn; tool?: ToolEvent };

function Detail({ session, lines, onBack }: { session: Session; lines: Line[]; onBack: () => void }) {
  return (
    <section className="panel calldetail">
      <header>
        <button className="btn small" onClick={onBack}>Back</button>
        <h3>Room {session.room ?? '—'}</h3>
        <span className="muted mono">{session.id}</span>
      </header>
      <p className="muted">{new Date(session.started_at).toLocaleString()}{session.ended_at ? ` to ${time(session.ended_at)}` : ' · on the line'}{session.agent_id ? ` · ${session.agent_id}` : ''}</p>
      <ol className="timeline">
        {lines.map((l) => (l.turn ? (
          <li key={l.turn.id} className={`said ${l.turn.role}`}>
            <small>{l.turn.role === 'guest' ? 'Guest' : 'Agent'} · {time(l.at)}</small>
            <span>{l.turn.text}</span>
          </li>
        ) : (
          <li key={l.tool!.id} className="action">
            <small>{nameOf(l.tool!.tool_name)} · <span className="mono">{l.tool!.tool_name}</span> · {time(l.at)}</small>
            {l.tool!.result_summary && <span>{l.tool!.result_summary}</span>}
            <details>
              <summary>Arguments and result</summary>
              <pre>{JSON.stringify(l.tool!.arguments, null, 1)}</pre>
              <pre>{JSON.stringify(l.tool!.result, null, 1)}</pre>
            </details>
          </li>
        )))}
        {!lines.length && <li className="muted">Nothing recorded for this call</li>}
      </ol>
    </section>
  );
}

export default function CallLogPanel({ records }: { records: Records | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('All');
  const groups = useMemo(() => (records?.sessions ?? []).map((session) => {
    const turns = records!.turns.filter((t) => t.session_id === session.id);
    const tools = records!.tools.filter((t) => t.session_id === session.id);
    const lines: Line[] = [...turns.map((turn) => ({ at: turn.created_at, turn })), ...tools.map((tool) => ({ at: tool.created_at, tool }))]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return { session, turns, tools, lines };
  }), [records]);
  const toolNames = useMemo(() => [...new Set(groups.flatMap((g) => g.tools.map((t) => t.tool_name)))], [groups]);
  const opened = groups.find((g) => g.session.id === open);
  if (opened) return <Detail session={opened.session} lines={opened.lines} onBack={() => setOpen(null)} />;
  const shown = filter === 'All' ? groups : groups.filter((g) => g.tools.some((t) => t.tool_name === filter));
  return (
    <>
      <div className="filters">
        {['All', ...toolNames].map((f) => (
          <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'All' ? 'All' : nameOf(f)}</button>
        ))}
      </div>
      <section className="panel rows">
        {shown.map((g) => {
          const said = g.turns.find((t) => t.role === 'guest')?.text ?? g.turns.find((t) => t.text !== FIRST_LINE)?.text;
          return (
            <button key={g.session.id} className="callrow" onClick={() => setOpen(g.session.id)}>
              <span className="mono muted">{time(g.session.started_at)}</span>
              <b>{g.session.room ?? '—'}</b>
              <span className="said-first">{said ? `“${said}”` : 'No transcript'}</span>
              {!g.session.ended_at && <span className="live-dot">Live</span>}
              {g.tools.some((t) => t.tool_name === 'escalate_to_frontdesk') && <span className="tag">Escalated</span>}
              <span className="mono muted">{g.tools.length} actions · {g.turns.length} said</span>
            </button>
          );
        })}
        {!shown.length && <p className="muted pad">{records ? 'No calls yet' : 'Loading calls…'}</p>}
      </section>
    </>
  );
}
