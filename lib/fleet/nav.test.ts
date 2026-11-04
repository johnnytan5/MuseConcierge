import test from 'node:test';
import assert from 'node:assert/strict';
import { route, waypoints, pursue, NODES, pathLength, doorFacingYaw } from './nav.ts';

test('route dock_1→door_804 passes pickup', () => {
  const r = route('dock_1', 'door_804', ['pickup']);
  assert.deepEqual(r.slice(0, 1), ['dock_1']);
  assert.ok(r.indexOf('pickup') > 0 && r.indexOf('pickup') < r.indexOf('door_804'));
  assert.equal(r.at(-1), 'door_804');
});

test('route goes through fault_point on the way to 804', () => {
  assert.ok(route('pickup', 'door_804').includes('fault_point'));
});

test('waypoints keep to the right-hand lane in the hall', () => {
  const east = waypoints(route('hall_803', 'hall_804'));
  const west = waypoints(route('hall_804', 'hall_803'));
  assert.ok(east.every((p) => p.y < 0));
  assert.ok(west.every((p) => p.y > 0));
  const north = waypoints(route('hall_1204', 'hall_1205'));
  assert.ok(north.every((p) => p.x > 3));
});

test('pursue drives a kinematic robot to the last waypoint and reports done within 0.15 m', () => {
  const pts = waypoints(route('dock_1', 'door_804'));
  let pose = { x: NODES.dock_1[0], y: NODES.dock_1[1], yaw: 0 };
  let idx = 0;
  let done = false;
  for (let i = 0; i < 20000 && !done; i++) {
    const c = pursue(pose, pts, idx);
    idx = c.idx;
    done = c.done;
    const dt = 0.02;
    pose = { x: pose.x + c.v * Math.cos(pose.yaw) * dt, y: pose.y + c.v * Math.sin(pose.yaw) * dt, yaw: pose.yaw + c.w * dt };
  }
  assert.ok(done);
  assert.ok(Math.hypot(pose.x - NODES.door_804[0], pose.y - NODES.door_804[1]) < 0.15);
});

test('pathLength sums segment lengths from a start point', () => {
  assert.equal(pathLength({ x: 0, y: 0 }, [{ x: 3, y: 4 }, { x: 3, y: 0 }]), 9);
});

test('at every stop the cabin door (the robot\'s -y side) faces the room or the desk', () => {
  const faces = (yaw: number) => [Math.round(Math.sin(yaw)), Math.round(-Math.cos(yaw)) + 0];
  const at = (id: string) => ({ x: NODES[id][0], y: NODES[id][1] });
  assert.deepEqual(faces(doorFacingYaw(at('door_803'))), [0, -1]);
  assert.deepEqual(faces(doorFacingYaw(at('door_804'))), [0, 1]);
  assert.deepEqual(faces(doorFacingYaw(at('door_1204'))), [1, 0]);
  assert.deepEqual(faces(doorFacingYaw(at('door_1205'))), [-1, 0]);
  assert.deepEqual(faces(doorFacingYaw(at('pickup'))), [-1, 0]);
});

test('the L corner: both directions turn where the lanes cross, clear of the inner wall', () => {
  const south = waypoints(route('hall_1204', 'hall_804'));
  assert.deepEqual(south[1], { x: 2.75, y: 0.25 }); // inner corner of the L is at (2.35, 0.65)
  const north = waypoints(route('hall_804', 'hall_1204'));
  assert.deepEqual(north[1], { x: 3.25, y: -0.25 });
});

test('each dock has its own way in from the hall', () => {
  assert.equal(route('hall_0', 'dock_1')[1], 'lobby_s');
  assert.equal(route('hall_0', 'dock_2')[1], 'lobby_n');
});
