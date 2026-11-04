// SimPort over MuJoCo (WASM): the engine's drive/lid/pose calls become wheel
// and door actuator targets on public/sim/floor.xml.
import type { Pose, RobotId, SimPort } from '../fleet/types.ts';
import { ROBOT_IDS } from '../fleet/types.ts';

const WHEEL_R = 0.06; // m, floor.xml wheel radius
const TRACK = 0.38; // m between wheel centres
// Wheel actuators are velocity servos, so ctrl (rad/s) maps to ground speed
// almost 1:1; measured 0.896 m of 0.9 m commanded over 3 s. Re-measure if
// the wheels, masses or kv change.
const WHEEL_GAIN = 1.0;
const DOOR_TOP_OPEN = 0.16; // m of slide travel, floor.xml door panels
const DOOR_BOTTOM_OPEN = 0.04;
const BASE_Z = 0.065; // free-joint height when resting on the floor
// A tall robot rocks if its wheels jump to speed, so speed changes are ramped.
const MAX_ACCEL = 0.5; // m/s^2
const MAX_TURN_ACCEL = 2.5; // rad/s^2

// The subset of the @mujoco/mujoco module this file uses.
type Mujoco = {
  mjtObj: { mjOBJ_ACTUATOR: { value: number }; mjOBJ_JOINT: { value: number }; mjOBJ_BODY: { value: number } };
  mj_name2id(m: unknown, type: number, name: string): number;
  mj_step(m: unknown, d: unknown): void;
  mj_forward(m: unknown, d: unknown): void;
};
type Model = { opt: { timestep: number }; jnt_qposadr: ArrayLike<number>; jnt_dofadr: ArrayLike<number> };
type Data = { ctrl: Float64Array; qpos: Float64Array; qvel: Float64Array; xpos: Float64Array; xquat: Float64Array; time: number };

type Ids = { body: number; qpos: number; dof: number; wl: number; wr: number; doorTop: number; doorBottom: number };

export class MjSim implements SimPort {
  mj: Mujoco;
  model: Model;
  data: Data;
  ids: Record<RobotId, Ids>;
  wanted: Record<string, { v: number; w: number }> = {};
  speed: Record<string, { v: number; w: number }> = {};

  constructor(mj: Mujoco, model: Model, data: Data) {
    this.mj = mj;
    this.model = model;
    this.data = data;
    const id = (type: { value: number }, name: string) => {
      const i = mj.mj_name2id(model, type.value, name);
      if (i < 0) throw new Error(`floor.xml has no ${name}`);
      return i;
    };
    const ids = {} as Record<RobotId, Ids>;
    for (const r of ROBOT_IDS) {
      const root = id(mj.mjtObj.mjOBJ_JOINT, `${r}_root`);
      ids[r] = {
        body: id(mj.mjtObj.mjOBJ_BODY, r),
        qpos: model.jnt_qposadr[root],
        dof: model.jnt_dofadr[root],
        wl: id(mj.mjtObj.mjOBJ_ACTUATOR, `${r}_wl`),
        wr: id(mj.mjtObj.mjOBJ_ACTUATOR, `${r}_wr`),
        doorTop: id(mj.mjtObj.mjOBJ_ACTUATOR, `${r}_door_top`),
        doorBottom: id(mj.mjtObj.mjOBJ_ACTUATOR, `${r}_door_bottom`),
      };
    }
    this.ids = ids;
    for (const r of ROBOT_IDS) {
      this.wanted[r] = { v: 0, w: 0 };
      this.speed[r] = { v: 0, w: 0 };
    }
  }

  pose(r: RobotId): Pose {
    const b = this.ids[r].body;
    const [w, x, y, z] = this.data.xquat.subarray(4 * b, 4 * b + 4);
    return { x: this.data.xpos[3 * b], y: this.data.xpos[3 * b + 1], yaw: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) };
  }

  drive(r: RobotId, v: number, w: number): void {
    this.wanted[r] = { v, w };
  }

  // One physics step's worth of the ramp from the current speed to the wanted one.
  applyDrive(dt: number): void {
    for (const r of ROBOT_IDS) {
      const i = this.ids[r];
      const now = this.speed[r];
      const toward = (from: number, to: number, step: number) => from + Math.max(-step, Math.min(step, to - from));
      now.v = toward(now.v, this.wanted[r].v, MAX_ACCEL * dt);
      now.w = toward(now.w, this.wanted[r].w, MAX_TURN_ACCEL * dt);
      this.data.ctrl[i.wl] = ((now.v - (now.w * TRACK) / 2) / WHEEL_R) * WHEEL_GAIN;
      this.data.ctrl[i.wr] = ((now.v + (now.w * TRACK) / 2) / WHEEL_R) * WHEEL_GAIN;
    }
  }

  lid(r: RobotId, open: boolean): void {
    this.data.ctrl[this.ids[r].doorTop] = open ? DOOR_TOP_OPEN : 0;
    this.data.ctrl[this.ids[r].doorBottom] = open ? DOOR_BOTTOM_OPEN : 0;
  }

  teleport(r: RobotId, p: Pose): void {
    const { qpos, dof } = this.ids[r];
    this.wanted[r] = { v: 0, w: 0 };
    this.speed[r] = { v: 0, w: 0 };
    this.data.qpos.set([p.x, p.y, BASE_Z, Math.cos(p.yaw / 2), 0, 0, Math.sin(p.yaw / 2)], qpos);
    this.data.qvel.fill(0, dof, dof + 6);
    this.mj.mj_forward(this.model, this.data);
  }

  // Advance physics by `seconds` of sim time.
  step(seconds: number): void {
    const n = Math.max(1, Math.round(seconds / this.model.opt.timestep));
    for (let i = 0; i < n; i++) {
      this.applyDrive(this.model.opt.timestep);
      this.mj.mj_step(this.model, this.data);
    }
  }
}
