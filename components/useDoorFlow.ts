'use client';

// What happens at a guest's door, driven from the fleet's state. The robot
// photographs the door and the cabin (SAM 3.1 and Muse Spark look at each
// photo), then waits. "Mimic collection" lifts the items out, photographs the
// cabin again, and only an empty cabin completes the delivery.
import { useCallback, useRef, useState } from 'react';
import type { CameraMode, SimCapture } from './SimView.tsx';
import type { FleetClient } from '@/lib/sim/client.ts';
import { logCall, escalate } from '@/lib/admin/client.ts';
import { lineItems, type FleetSnapshot, type RobotId, type Task } from '@/lib/fleet/types.ts';
import { cabinVerdict, kindFor, verdict, type CabinCheck, type DoorCheck, type ItemKind, type Verdict } from '@/lib/vision/doorcheck.ts';

export type DoorFlow = {
  taskId: string;
  room: string;
  robotId: RobotId;
  kinds: ItemKind[];
  step: 'door_photo' | 'cabin_photo' | 'waiting' | 'collecting' | 'checking' | 'collected' | 'still_there' | 'unknown' | 'timed_out';
  door?: { image: string; result?: DoorCheck; verdict?: Verdict };
  before?: { image: string; result?: CabinCheck };
  after?: { image: string; result?: CabinCheck };
  error?: string;
};

export type Tip = { id: number; text: string };

const SETTLE_MS = 2500; // the robot turns to the room and its door opens
const CAMERA_MS = 900; // a beat on the new view before the shutter
const AFTER_DOOR_MS = 2500;
const STAGE_BACK_MS = 6000; // the result stays on screen, then back to the floor

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const kindsOf = (t: Task) => [...new Set(lineItems(t).map((l) => kindFor(l.item)).filter((k): k is ItemKind => !!k))];

export function useDoorFlow(deps: {
  capture: { current: SimCapture | null };
  client: FleetClient | null;
  callId: { current: string | null };
  setCamera: (c: CameraMode) => void;
  addNote: (n: { id: string; at: number; room: string; text: string }) => void;
}) {
  const { capture, client, callId, setCamera, addNote } = deps;
  const [flow, setFlow] = useState<DoorFlow | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [flash, setFlash] = useState(0);
  const [resultOpen, setResultOpen] = useState(false);
  const started = useRef(new Set<string>());
  const current = useRef<DoorFlow | null>(null);

  const update = useCallback((patch: Partial<DoorFlow> | null) => {
    current.current = patch && current.current ? { ...current.current, ...patch } : (patch as DoorFlow | null);
    setFlow(current.current);
  }, []);

  const shutter = useCallback((text: string) => {
    setFlash((n) => n + 1);
    setTip({ id: Date.now(), text });
  }, []);

  const post = useCallback(async <T,>(body: object): Promise<T> => {
    const res = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, callId: callId.current }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `vision ${res.status}`);
    return json;
  }, [callId]);

  const run = useCallback(async (t: Task, robotId: RobotId) => {
    const kinds = kindsOf(t);
    current.current = null;
    update({ taskId: t.id, room: t.room, robotId, kinds, step: 'door_photo' });
    const stale = () => current.current?.taskId !== t.id;
    setCamera({ pov: 'door', robot: robotId, room: t.room });
    await sleep(SETTLE_MS);
    if (stale()) return;

    const doorImage = capture.current?.door(robotId, t.room);
    if (doorImage) {
      shutter(`Picture taken. Sent to SAM 3.1 and Muse Spark to find door ${t.room}.`);
      update({ door: { image: doorImage } });
      setResultOpen(true);
      post<DoorCheck>({ image: doorImage, room: t.room }).then((result) => {
        if (stale()) return;
        const v = verdict(t.room, result);
        update({ door: { image: doorImage, result, verdict: v } });
        void logCall(callId.current, { tool: { name: 'door_check', args: { room: t.room, robot: robotId, models: ['sam-3.1', 'muse-spark'] }, result, summary: `Plate reads ${result.number ?? '?'}: ${v.replace('_', ' ')}` } });
        if (v === 'confirmed') addNote({ id: `${t.id}-door`, at: Date.now(), room: t.room, text: 'Robot at your door' });
      }).catch((e) => { if (!stale()) update({ error: e.message }); });
      await sleep(AFTER_DOOR_MS);
      if (stale()) return;
    }

    update({ step: 'cabin_photo' });
    setCamera({ pov: 'cabin', robot: robotId, room: t.room });
    await sleep(CAMERA_MS);
    if (stale()) return;
    const image = kinds.length ? capture.current?.cabin(robotId) : null;
    if (image) {
      shutter('Picture taken. Sent to SAM 3.1 for segmentation of the cabin.');
      update({ before: { image }, step: 'waiting' });
      setResultOpen(true);
      try {
        const result = await post<CabinCheck>({ image, items: kinds });
        if (!stale()) update({ before: { image, result } });
        void logCall(callId.current, { tool: { name: 'cabin_check', args: { when: 'on arrival', items: kinds, model: 'sam-3.1' }, result, summary: cabinVerdict(result) === 'occupied' ? 'Items seen in the cabin' : 'Nothing seen in the cabin' } });
      } catch (e) {
        if (!stale()) update({ error: e instanceof Error ? e.message : 'cabin check failed' });
      }
    } else {
      update({ step: 'waiting' });
    }
  }, [addNote, capture, post, setCamera, shutter, update]);

  // Photograph the cabin and ask SAM. An empty result is checked once more
  // before anyone believes it: one missed detection must not end a delivery.
  const checkCabin = useCallback(async (kinds: ItemKind[], robotId: RobotId) => {
    const image = capture.current!.cabin(robotId)!;
    update({ after: { image } });
    let result = await post<CabinCheck>({ image, items: kinds });
    if (cabinVerdict(result) === 'empty') {
      const again = await post<CabinCheck>({ image: capture.current!.cabin(robotId) ?? image, items: kinds });
      result = { ...again, ms: result.ms + again.ms };
    }
    return { image, result };
  }, [capture, post, update]);

  const collect = useCallback(async () => {
    const f = current.current;
    if (!f || !client || !['waiting', 'still_there', 'unknown'].includes(f.step)) return;
    const stale = () => current.current?.taskId !== f.taskId;
    setCamera({ pov: 'cabin', robot: f.robotId, room: f.room });
    if (f.step === 'waiting') {
      update({ step: 'collecting' });
      await capture.current?.takeOut(f.robotId);
      if (stale()) return;
    }
    update({ step: 'checking' });
    let state: DoorFlow['step'] = 'collected';
    if (f.kinds.length) {
      shutter('Picture taken. Sent to SAM 3.1 to check the cabin is empty.');
      try {
        const { image, result } = await checkCabin(f.kinds, f.robotId);
        if (stale()) return;
        update({ after: { image, result } });
        setResultOpen(true);
        const v = cabinVerdict(result);
        void logCall(callId.current, { tool: { name: 'cabin_check', args: { when: 'after collection', items: f.kinds, model: 'sam-3.1' }, result, summary: `Cabin ${v}` } });
        state = v === 'empty' ? 'collected' : v === 'occupied' ? 'still_there' : 'unknown';
      } catch (e) {
        if (stale()) return;
        update({ error: e instanceof Error ? e.message : 'cabin check failed' });
        state = 'unknown';
      }
    }
    update({ step: state });
    if (state !== 'collected') return;
    await client.collect(f.taskId);
    void logCall(callId.current, { tool: { name: 'collection', args: { task: f.taskId, room: f.room, robot: f.robotId }, result: { collected: true }, summary: 'Guest collected; robot leaving' } });
    await sleep(STAGE_BACK_MS);
    if (!stale()) {
      setCamera('overview');
      setTip(null);
    }
  }, [callId, capture, checkCabin, client, setCamera, shutter, update]);

  // Called with every state update.
  const onState = useCallback((s: FleetSnapshot) => {
    const t = s.tasks.find((x) => x.status === 'at_door' && !started.current.has(x.id));
    if (t?.robotId) {
      started.current.add(t.id);
      void run(t, t.robotId);
    }
    const f = current.current;
    if (f && s.tasks.find((x) => x.id === f.taskId)?.status === 'not_collected' && f.step !== 'timed_out') {
      update({ step: 'timed_out' });
      setCamera('overview');
      void escalate(callId.current, `Order ${f.taskId} was not collected at the door`, f.room);
    }
  }, [callId, run, setCamera, update]);

  const reset = useCallback(() => {
    started.current.clear();
    update(null);
    setTip(null);
    setResultOpen(false);
  }, [update]);

  return { flow, tip, flash, resultOpen, collect, onState, reset, dismissTip: () => setTip(null), closeResult: () => setResultOpen(false) };
}
