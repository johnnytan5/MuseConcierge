// Physics and the fleet engine, off the main thread so the voice call and
// the UI never stall on mj_step. The page talks to it through FleetClient.
import type loadMujocoType from '@mujoco/mujoco';
import { MjSim } from './mjsim.ts';
import { Fleet } from '../fleet/engine.ts';
import { decisionContext } from '../fleet/options.ts';
import type { FleetSnapshot } from '../fleet/types.ts';
import type { FromWorker, GeomInfo, Request, Reply, ToWorker } from './protocol.ts';

const STEP_MS = 1000 / 60;
const FRAME_EVERY = 2; // 30 Hz frames
const STATE_MS = 250;

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

let fleet: Fleet;
let sim: MjSim;
let demo = false;
const opts = () => ({ demoFault: demo, collection: true });
const ready = boot();

async function boot() {
  const url = '/sim/mujoco.js'; // copied there by scripts/copy-wasm.mjs
  const loadMujoco: typeof loadMujocoType = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)).default;
  const mj = await loadMujoco({ locateFile: (f: string) => `/sim/${f}` });
  const xml = await (await fetch('/sim/floor.xml')).text();
  const model = mj.MjModel.from_xml_string(xml);
  const data = new mj.MjData(model);
  sim = new MjSim(mj as never, model as never, data as never);

  const geoms: GeomInfo[] = [];
  for (let i = 0; i < model.ngeom; i++) {
    geoms.push({
      name: mj.mj_id2name(model, mj.mjtObj.mjOBJ_GEOM.value, i) ?? '',
      type: model.geom_type[i],
      size: Array.from(model.geom_size.subarray(3 * i, 3 * i + 3)),
      rgba: Array.from(model.geom_rgba.subarray(4 * i, 4 * i + 4)),
    });
  }
  post({ type: 'static', geoms });
  return { mj, model, data };
}

function placeRobots() {
  for (const r of fleet.robots) sim.teleport(r.id, r.pose);
}

function handle(req: Request): Reply {
  switch (req.kind) {
    case 'createTask': return fleet.createTask(req.args);
    case 'getTask': return fleet.getTask(req.id);
    case 'cancelTask': return fleet.cancelTask(req.id);
    case 'apply': return fleet.apply(req.decision);
    case 'fault': return fleet.injectBatteryFault(req.robotId);
    case 'collect': return fleet.collect(req.taskId);
    case 'snapshot': return fleet.snapshot();
    case 'reset':
      fleet = new Fleet(Date.now, opts());
      fleet.seedDemo();
      placeRobots();
      return true;
  }
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      const { mj, model, data } = await ready;
      demo = msg.demo;
      mj.mj_resetData(model, data);
      fleet = msg.snapshot ? Fleet.restore(msg.snapshot as FleetSnapshot, Date.now, opts()) : new Fleet(Date.now, opts());
      if (!msg.snapshot) fleet.seedDemo();
      placeRobots();
      run(model, data);
    } else {
      await ready;
      post({ type: 'res', id: msg.id, result: handle(msg.req) });
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};

let running = false;
function run(model: { ngeom: number }, data: { geom_xpos: Float64Array; geom_xmat: Float64Array }) {
  if (running) return;
  running = true;
  let last = performance.now();
  let lastState = 0;
  let n = 0;
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000); // a throttled tab must not make the sim jump
    last = now;
    sim.step(dt);
    fleet.tick(dt, sim);

    const events = fleet.drain();
    if (events.length) {
      const snap = fleet.snapshot();
      post({ type: 'events', events: events.map((event) => ({ event, context: decisionContext(event, snap) })), snapshot: snap });
    }
    if (++n % FRAME_EVERY === 0) {
      const xpos = Float32Array.from(data.geom_xpos.subarray(0, 3 * model.ngeom));
      const xmat = Float32Array.from(data.geom_xmat.subarray(0, 9 * model.ngeom));
      post({ type: 'frame', xpos, xmat }, [xpos.buffer, xmat.buffer]);
    }
    if (now - lastState > STATE_MS) {
      lastState = now;
      post({ type: 'state', snapshot: fleet.snapshot() });
    }
  }, STEP_MS);
}
