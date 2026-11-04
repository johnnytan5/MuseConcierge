'use client';

// three.js view of the MuJoCo scene. Meshes are built from the model's geoms
// (static message) and moved each frame from geom_xpos/geom_xmat. MuJoCo is
// z-up, so the scene keeps z-up and the cameras use up = +z.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { FleetClient } from '@/lib/sim/client.ts';
import type { GeomInfo } from '@/lib/sim/protocol.ts';
import type { RobotId } from '@/lib/fleet/types.ts';
import { buildDoorstep, doorCamera, guestCamera, captureJpeg, PHOTO_LAYER, FRAME } from './doorstep.ts';
import { buildCabin, type Cabin } from './items.ts';
import type { ItemKind } from '@/lib/vision/doorcheck.ts';

// pov: the stage shows what the guest at the door sees, or the cabin camera.
export type CameraMode = 'overview' | RobotId | { pov: 'guest' | 'cabin'; robot: RobotId; room: string };

// The robots' cameras, rendered to JPEG data URLs; null before the model loads.
export type SimCapture = {
  door(robot: RobotId, room: string): string | null;
  cabin(robot: RobotId): string | null;
  setItems(robot: RobotId, kinds: ItemKind[]): void;
  takeOut(robot: RobotId): Promise<void>;
  guestView(robot: RobotId, reaching?: boolean): string | null;
};

const OVERVIEW_DIR = new THREE.Vector3(0, -0.14, 1).normalize(); // from the floor centre toward the overview camera

const GEOM = { plane: 0, sphere: 2, capsule: 3, ellipsoid: 4, cylinder: 5, box: 6 } as const;

function meshFor(g: GeomInfo): THREE.Mesh | null {
  const [a, b, c] = g.size;
  let geo: THREE.BufferGeometry;
  if (g.type === GEOM.plane) geo = new THREE.PlaneGeometry(2 * a, 2 * b);
  else if (g.type === GEOM.box) geo = new THREE.BoxGeometry(2 * a, 2 * b, 2 * c);
  else if (g.type === GEOM.sphere) geo = new THREE.SphereGeometry(a, 20, 14);
  else if (g.type === GEOM.cylinder) geo = new THREE.CylinderGeometry(a, a, 2 * b, 24).rotateX(Math.PI / 2);
  else if (g.type === GEOM.capsule) geo = new THREE.CapsuleGeometry(a, 2 * b, 6, 16).rotateX(Math.PI / 2);
  else return null;
  const [r, gr, bl, alpha] = g.rgba;
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(r, gr, bl), transparent: alpha < 1, opacity: alpha, roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.castShadow = g.type !== GEOM.plane;
  mesh.receiveShadow = true;
  // The door camera's photo layer has its own walls, doors and floor.
  if (!/^(wall_|door_|carpet_)/.test(g.name)) mesh.layers.enable(PHOTO_LAYER);
  return mesh;
}

function label(text: string, color = '#1d1d1f', scale = 0.55): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.beginPath();
  ctx.roundRect(8, 12, 240, 72, 18);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = '600 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 50);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
  sprite.scale.set(scale * 2.67, scale, 1);
  return sprite;
}

export default function SimView({ client, camera = 'overview', captureRef }: { client: FleetClient | null; camera?: CameraMode; captureRef?: { current: SimCapture | null } }) {
  const host = useRef<HTMLDivElement>(null);
  const cameraMode = useRef<CameraMode>(camera);
  cameraMode.current = camera;

  useEffect(() => {
    if (!client || !host.current) return;
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#b4b4b4');
    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.2);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(0, -2, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
    sun.target.position.set(1.35, 0.85, 0);
    scene.add(sun, sun.target);
    hemi.layers.enableAll();
    sun.layers.enableAll();

    const cam = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    cam.up.set(0, 0, 1);

    // Room labels stand over each room's bed; dock labels sit past the lobby
    // walls so they never cover a docked robot's own tag.
    const roomLabels: Record<string, [number, number]> = { 803: [1, -1.15], 804: [2, 1.15], 1204: [4.15, 1], 1205: [1.85, 2] };
    for (const [room, [x, y]] of Object.entries(roomLabels)) {
      const s = label(room, '#1d1d1f', 0.2);
      s.position.set(x, y, 1.3);
      scene.add(s);
    }
    const fixed: [string, string, number, number, number][] = [['Front desk', '#1d1d1f', -1.2, 0, 1.2], ['Dock 1', '#a36100', -0.62, -1.12, 1.1], ['Dock 2', '#14705a', -0.62, 1.12, 1.1]];
    for (const [text, color, x, y, z] of fixed) {
      const s = label(text, color, 0.17);
      s.position.set(x, y, z);
      scene.add(s);
    }
    const robotTags = { robot_1: label('Robot 1', '#a36100', 0.17), robot_2: label('Robot 2', '#14705a', 0.17) };
    scene.add(robotTags.robot_1, robotTags.robot_2);

    let meshes: (THREE.Mesh | null)[] = [];
    let bodyIdx: Record<RobotId, number> = { robot_1: -1, robot_2: -1 };
    const cabins = {} as Record<RobotId, Cabin>;
    const unsubscribe = client.subscribe({
      onStatic(geoms) {
        buildDoorstep(scene, geoms);
        meshes = geoms.map((g) => {
          const m = meshFor(g);
          if (m) scene.add(m);
          return m;
        });
        bodyIdx = { robot_1: geoms.findIndex((g) => g.name === 'robot_1_chassis'), robot_2: geoms.findIndex((g) => g.name === 'robot_2_chassis') };
        for (const id of ['robot_1', 'robot_2'] as RobotId[]) {
          const chassis = meshes[bodyIdx[id]];
          if (chassis) cabins[id] = buildCabin(chassis, FRAME.w / FRAME.h, PHOTO_LAYER);
        }
      },
      onFrame(xpos, xmat) {
        const m4 = new THREE.Matrix4();
        meshes.forEach((mesh, i) => {
          if (!mesh) return;
          const r = xmat.subarray(9 * i, 9 * i + 9);
          m4.set(r[0], r[1], r[2], xpos[3 * i], r[3], r[4], r[5], xpos[3 * i + 1], r[6], r[7], r[8], xpos[3 * i + 2], 0, 0, 0, 1);
          mesh.matrix.copy(m4);
        });
        for (const id of ['robot_1', 'robot_2'] as RobotId[]) {
          const i = bodyIdx[id];
          if (i >= 0) robotTags[id].position.set(xpos[3 * i], xpos[3 * i + 1], xpos[3 * i + 2] + 1.0);
          robotTags[id].visible = cameraMode.current !== id; // would cover the robot being followed
        }
      },
    });

    if (captureRef) {
      captureRef.current = {
        door(robot, room) {
          const mesh = meshes[bodyIdx[robot]];
          return mesh ? captureJpeg(renderer, scene, doorCamera(new THREE.Vector3().setFromMatrixPosition(mesh.matrix), room)) : null;
        },
        cabin(robot) {
          const c = cabins[robot]?.camera;
          if (!c) return null;
          c.aspect = FRAME.w / FRAME.h;
          c.updateProjectionMatrix();
          return captureJpeg(renderer, scene, c);
        },
        setItems(robot, kinds) {
          cabins[robot]?.setItems(kinds);
        },
        takeOut(robot) {
          return cabins[robot]?.takeOut() ?? Promise.resolve();
        },
        // What a guest sees, from the cabin's frame: standing in the room's
        // doorway at 1.5 m eye height, or stepped up and bending to reach in.
        guestView(robot, reaching = false) {
          const cabin = cabins[robot];
          if (!cabin) return null;
          const cam = new THREE.PerspectiveCamera(reaching ? 60 : 42, FRAME.w / FRAME.h, 0.05, 30);
          cam.layers.set(PHOTO_LAYER);
          cam.up.set(0, 0, 1);
          if (reaching) cam.position.set(0, -0.5, 0.42);
          else cam.position.set(0, -0.62, 1.2);
          cam.lookAt(0, 0, reaching ? 0.08 : 0.25);
          cabin.frame.add(cam);
          const shot = captureJpeg(renderer, scene, cam);
          cabin.frame.remove(cam);
          return shot;
        },
      };
    }

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Overview frames the whole floor; follow sits behind and above a robot.
    const goal = new THREE.Vector3();
    const look = new THREE.Vector3();
    const lookAt = new THREE.Vector3(1.35, 0.85, 0);
    let raf = 0;
    const loop = () => {
      const mode = cameraMode.current;
      if (typeof mode === 'object') {
        const body = meshes[bodyIdx[mode.robot]];
        const pov = !body ? null : mode.pov === 'cabin' ? cabins[mode.robot]?.camera : guestCamera(mode.room);
        if (pov) {
          // Same sideways view as the photo, however tall the stage is.
          const aspect = el.clientWidth / Math.max(1, el.clientHeight);
          const photoFov = pov.fov;
          const frameAspect = FRAME.w / FRAME.h;
          pov.aspect = aspect;
          if (aspect < frameAspect) pov.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(photoFov / 2)) * (frameAspect / aspect)));
          pov.updateProjectionMatrix();
          renderer.render(scene, pov);
          pov.fov = photoFov;
          raf = requestAnimationFrame(loop);
          return;
        }
      }
      const i = typeof mode === 'object' || mode === 'overview' ? -1 : bodyIdx[mode];
      const mesh = i >= 0 ? meshes[i] : null;
      if (mesh) {
        const p = new THREE.Vector3().setFromMatrixPosition(mesh.matrix);
        const fwd = new THREE.Vector3(mesh.matrix.elements[0], mesh.matrix.elements[1], 0).normalize();
        goal.copy(p).addScaledVector(fwd, -0.9).add(new THREE.Vector3(0, 0, 2.1));
        look.copy(p).addScaledVector(fwd, 0.5);
      } else {
        // Back off along a fixed viewing angle just far enough that the whole
        // floor (6.6 m x 5.1 m) fits the stage at its current aspect.
        const vHalf = THREE.MathUtils.degToRad(cam.fov / 2);
        const hHalf = Math.atan(Math.tan(vHalf) * cam.aspect);
        const d = 1.06 * Math.max(3.4 / Math.tan(hHalf), 2.7 / Math.tan(vHalf));
        goal.set(1.35, 0.85, 0).addScaledVector(OVERVIEW_DIR, d);
        look.set(1.35, 0.85, 0);
      }
      cam.position.lerp(goal, 0.08);
      lookAt.lerp(look, 0.12);
      cam.lookAt(lookAt);
      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    cam.position.set(1.35, -0.5, 10);
    loop();

    return () => {
      cancelAnimationFrame(raf);
      if (captureRef) captureRef.current = null;
      ro.disconnect();
      unsubscribe();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [client, captureRef]);

  return <div ref={host} style={{ width: '100%', height: '100%', minHeight: 320 }} />;
}
