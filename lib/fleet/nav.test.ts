import test from 'node:test';
import assert from 'node:assert/strict';
import { route, waypoints, pursue, NODES, pathLength } from './nav.ts';

test('route dock_1→door_804 passes pickup', () => {
  const r = route('dock_1', 'door_804', ['pickup']);
  assert.deepEqual(r.slice(0, 1), ['dock_1']);
  assert.ok(r.indexOf('pickup') > 0 && r.indexOf('pickup') < r.indexOf('door_804'));
  assert.equal(r.at(-1), 'door_804');
});

test('route goes through fault_point between hall_5 and hall_8', () => {
  assert.ok(route('pickup', 'door_804').includes('fault_point'));
});

test('waypoints keep to the right-hand lane in the hall', () => {
  const east = waypoints(route('hall_5', 'hall_8'));
  const west = waypoints(route('hall_8', 'hall_5'));
  assert.ok(east.every((p) => p.y < 0));
  assert.ok(west.every((p) => p.y > 0));
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
