'use client';

// Past calls. Opening one shows what happened as a flow, then how the call
// went line by line: everything said, and every action with its details.
import { useEffect, useMemo, useState } from 'react';
import { argLines, flowActions, flowOutcomes, replyMs, toolLabel, type FlowNode } from '@/lib/admin/flow.ts';
import type { Records, Session, ToolEvent, Turn } from './useRecords.ts';

const time = (iso: string) => new Date(iso).toLocaleTimeString();
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

type Group = { session: Session; turns: Turn[]; tools: ToolEvent[] };

function Node({ node, lit }: { node: FlowNode; lit: boolean }) {
  return (
    <div className={`node ${lit ? 'lit' : ''} ${lit && node.alert ? 'alert' : ''}`}>
      <span>{node.label}</span>
      {node.count > 1 && <span className="times">×{node.count}</span>}
    </div>
  );
}

function CallDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const { session, turns, tools } = group;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const guest = session.room ? `Guest in ${session.room}` : 'Guest';
  const entries = [
    ...turns.map((turn) => ({ at: Date.parse(turn.created_at), turn, tool: null })),
    ...tools.map((tool) => ({ at: Date.parse(tool.created_at), turn: null, tool })),
  ].sort((a, b) => a.at - b.at);
  const guestTimes = turns.filter((t) => t.role === 'guest').map((t) => Date.parse(t.created_at));
  const outcomes = flowOutcomes(tools);
  const brain = tools.some((t) => t.tool_name === 'brain_decision');
  const cameras = tools.some((t) => t.tool_name === 'door_check' || t.tool_name === 'cabin_check');
  const replies = turns.filter((t) => t.role === 'agent').map((t) => replyMs(Date.parse(t.created_at), guestTimes)).filter((n): n is number => n !== null).sort((a, b) => a - b);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label={`Call from room ${session.room ?? 'unknown'}`} onClick={(e) => e.stopPropagation()}>
        <header className="dialog-head">
          <span className="dialog-title">Call {session.id.replace(/^(sess_|muse_|web_)/, '').toUpperCase()}</span>
          {session.room && <span className="dialog-room"><small>Guest in</small><b>{session.room}</b></span>}
          {tools.some((t) => t.tool_name === 'escalate_to_frontdesk') && <span className="tag">Escalated</span>}
          <span className="spacer" />
          <span className="mono muted">{time(session.started_at)}</span>
          <span className="mono muted">{turns.length} said</span>
          <span className="mono muted">{tools.length} actions</span>
          <button className="btn small" onClick={onClose}>Close</button>
        </header>
        <div className="dialog-body">
          <section className="flow-panel">
            <h6>What happened</h6>
            <div className="flow">
              <div className="flow-col">
                <small>Who</small>
                <Node node={{ label: guest, count: 0 }} lit={turns.some((t) => t.role === 'guest')} />
                <Node node={{ label: 'Assistant', count: 0 }} lit={turns.some((t) => t.role === 'agent')} />
                {brain && <Node node={{ label: 'Fleet brain', count: 0 }} lit />}
                {cameras && <Node node={{ label: 'Delivery robot', count: 0 }} lit />}
              </div>
              <span className="flow-arrow" aria-hidden="true">&gt;</span>
              <div className="flow-col">
                <small>What it did</small>
                {flowActions(tools).map((n) => <Node key={n.label} node={n} lit={n.count > 0} />)}
              </div>
              <span className="flow-arrow" aria-hidden="true">&gt;</span>
              <div className="flow-col">
                <small>Result</small>
                {outcomes.length ? outcomes.map((n) => <Node key={n.label} node={n} lit />) : <Node node={{ label: 'No order placed', count: 0 }} lit={false} />}
              </div>
            </div>
          </section>
          <section className="flow-panel">
            <h6>How the call went{replies.length > 0 && <span className="mono muted aside">Typically answered in {seconds(replies[Math.floor(replies.length / 2)])}</span>}</h6>
            <div className="callsteps">
              {entries.map((e) => {
                const after = replyMs(e.at, guestTimes);
                if (e.turn) {
                  return (
                    <div key={e.turn.id} className="step">
                      <span className="mono muted when">{time(e.turn.created_at)}</span>
                      <span className="who">{e.turn.role === 'guest' ? guest : 'Assistant'}</span>
                      <span className={`words ${e.turn.role}`}>{e.turn.text}</span>
                      {e.turn.role === 'agent' && after !== null && <span className="took">{seconds(after)}</span>}
                    </div>
                  );
                }
                const t = e.tool!;
                return (
                  <div key={t.id} className="step action">
                    <span className="mono muted when">{time(t.created_at)}</span>
                    <span className={`who chip ${t.tool_name === 'escalate_to_frontdesk' ? 'alert' : ''}`}>Action</span>
                    <div className="what">
                      <strong className="mono">{toolLabel(t.tool_name)}</strong>
                      {argLines(t.arguments).map((a) => <div key={a.k} className="arg mono"><span>{a.k}</span><span>{a.v}</span></div>)}
                    </div>
                    <div className="outcome">{t.result_summary ?? '—'}</div>
                  </div>
                );
              })}
              {!entries.length && <p className="muted pad">Nothing was recorded for this call.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function CallLogPanel({ records }: { records: Records | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups: Group[] = useMemo(() => (records?.sessions ?? []).map((session) => ({
    session,
    turns: records!.turns.filter((t) => t.session_id === session.id),
    tools: records!.tools.filter((t) => t.session_id === session.id),
  })), [records]);
  const opened = groups.find((g) => g.session.id === open);
  return (
    <>
      <section className="panel rows">
        {groups.map((g) => {
          const said = g.turns.find((t) => t.role === 'guest')?.text;
          return (
            <button key={g.session.id} className="callrow" onClick={() => setOpen(g.session.id)}>
              <span className="mono muted">{new Date(g.session.started_at).toLocaleString()}</span>
              <b>{g.session.room ?? '—'}</b>
              <span className="said-first">{said ? `“${said}”` : 'No transcript'}</span>
              {!g.session.ended_at && <span className="live-dot">Live</span>}
              {g.tools.some((t) => t.tool_name === 'escalate_to_frontdesk') && <span className="tag">Escalated</span>}
              <span className="mono muted">{g.tools.length} actions · {g.turns.length} said</span>
              <span className="open-tag">Open</span>
            </button>
          );
        })}
        {!groups.length && <p className="muted pad">{records ? 'Every guest call shows up here.' : 'Loading calls…'}</p>}
      </section>
      {opened && <CallDialog group={opened} onClose={() => setOpen(null)} />}
    </>
  );
}
