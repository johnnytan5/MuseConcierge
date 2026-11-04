'use client';

// The presenter's stand-in for the guest at the door.
import { ITEM_LABEL } from '@/lib/vision/doorcheck.ts';
import type { DoorFlow } from './useDoorFlow.ts';

const STATUS: Record<DoorFlow['step'], string> = {
  door_photo: 'Robot arriving, checking the door…',
  cabin_photo: 'Photographing the cabin…',
  waiting: 'Waiting for the guest to collect',
  collecting: 'Guest is taking the items…',
  checking: 'SAM 3.1 is checking the cabin…',
  collected: 'Collected. Robot is leaving.',
  still_there: 'SAM 3.1 still sees something in the cabin',
  unknown: 'Could not check the cabin. Try again.',
  timed_out: 'Nobody collected. Robot went home.',
};

export default function CollectPanel({ flow, onCollect }: { flow: DoorFlow | null; onCollect: () => void }) {
  const ready = !!flow && ['waiting', 'still_there', 'unknown'].includes(flow.step);
  return (
    <section className="panel">
      <h6>At the door</h6>
      <button className="btn primary" disabled={!ready} onClick={onCollect}>
        {flow?.step === 'still_there' || flow?.step === 'unknown' ? 'Check the cabin again' : 'Mimic collection'}
      </button>
      <small className="muted">
        {flow ? STATUS[flow.step] : 'Available when a robot reaches a guest\'s door'}
        {flow && flow.step === 'waiting' && flow.kinds.length > 0 && `: ${flow.kinds.map((k) => ITEM_LABEL[k]).join(' + ')}`}
      </small>
    </section>
  );
}
