'use client';

// three.js view of the MuJoCo scene. Meshes are built from the model's geoms
// (static message) and moved each frame from geom_xpos/geom_xmat. MuJoCo is
// z-up, so the scene keeps z-up and the cameras use up = +z.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { FleetClient } from '@/lib/sim/client.ts';
import type { GeomInfo } from '@/lib/sim/protocol.ts';
import type { RobotId } from '@/lib/fleet/types.ts';
import { NODES } from '@/lib/fleet/nav.ts';
import { buildDoorstep, doorCamera, captureJpeg, PHOTO_LAYER } from './doorstep.ts';

export type CameraMode = 'overview' | RobotId;

// Renders robot's door camera at room into a JPEG data URL, or null before the model loads.
export type DoorCapture = (robot: RobotId, room: string) => string | null;

const OVERVIEW_DIR = new THREE.Vector3(0, -0.5, 1).normalize(); // from the floor centre toward the overview camera

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
  if (!/^(wall_|door_|floor$)/.test(g.name)) mesh.layers.enable(PHOTO_LAYER);
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

export default function SimView({ client, camera = 'overview', captureRef }: { client: FleetClient | null; camera?: CameraMode; captureRef?: { current: DoorCapture | null } }) {
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
    scene.background = new THREE.Color('#1b1d22');
    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.2);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(4, -3, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
    sun.target.position.set(5.5, 0, 0);
    scene.add(sun, sun.target);
    hemi.layers.enableAll();
    sun.layers.enableAll();
    buildDoorstep(scene);

    const cam = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    cam.up.set(0, 0, 1);

    for (const room of ['801', '802', '803', '804', '805', '806']) {
      const [x, y] = NODES[`door_${room}`];
      const s = label(room);
      s.position.set(x, y > 0 ? 1.95 : -1.95, 1.0);
      scene.add(s);
    }
    // Dock labels sit by the wall so they never cover a docked robot's own tag.
    const fixed: [string, string, number, number, number][] = [['Pickup', '#1f4e79', 2.5, -1.75, 1.35], ['Dock 1', '#a36100', -0.55, -1.35, 0.5], ['Dock 2', '#14705a', -0.55, 1.35, 0.5]];
    for (const [text, color, x, y, z] of fixed) {
      const s = label(text, color, 0.4);
      s.position.set(x, y, z);
      scene.add(s);
    }
    const robotTags = { robot_1: label('Robot 1', '#a36100', 0.42), robot_2: label('Robot 2', '#14705a', 0.42) };
    scene.add(robotTags.robot_1, robotTags.robot_2);

    let meshes: (THREE.Mesh | null)[] = [];
    let bodyIdx: Record<RobotId, number> = { robot_1: -1, robot_2: -1 };
    const unsubscribe = client.subscribe({
      onStatic(geoms) {
        meshes = geoms.map((g) => {
          const m = meshFor(g);
          if (m) scene.add(m);
          return m;
        });
        bodyIdx = { robot_1: geoms.findIndex((g) => g.name === 'robot_1_body'), robot_2: geoms.findIndex((g) => g.name === 'robot_2_body') };
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
          if (i >= 0) robotTags[id].position.set(xpos[3 * i], xpos[3 * i + 1], xpos[3 * i + 2] + 0.55);
        }
      },
    });

    if (captureRef) {
      captureRef.current = (robot, room) => {
        const mesh = meshes[bodyIdx[robot]];
        return mesh ? captureJpeg(renderer, scene, doorCamera(new THREE.Vector3().setFromMatrixPosition(mesh.matrix), room)) : null;
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
    const lookAt = new THREE.Vector3(5.6, 0.3, 0);
    let raf = 0;
    const loop = () => {
      const mode = cameraMode.current;
      const i = mode === 'overview' ? -1 : bodyIdx[mode];
      const mesh = i >= 0 ? meshes[i] : null;
      if (mesh) {
        const p = new THREE.Vector3().setFromMatrixPosition(mesh.matrix);
        const fwd = new THREE.Vector3(mesh.matrix.elements[0], mesh.matrix.elements[1], 0).normalize();
        goal.copy(p).addScaledVector(fwd, -1.6).add(new THREE.Vector3(0, 0, 1.3));
        look.copy(p).addScaledVector(fwd, 1.2);
      } else {
        // Back off along a fixed viewing angle just far enough that the whole
        // floor (13.4 m x 4.2 m) fits the stage at its current aspect.
        const vHalf = THREE.MathUtils.degToRad(cam.fov / 2);
        const hHalf = Math.atan(Math.tan(vHalf) * cam.aspect);
        const d = 1.04 * Math.max(6.7 / Math.tan(hHalf), 3.4 / Math.tan(vHalf));
        goal.set(5.6, 0.3, 0).addScaledVector(OVERVIEW_DIR, d);
        look.set(5.6, 0.3, 0);
      }
      cam.position.lerp(goal, 0.08);
      lookAt.lerp(look, 0.12);
      cam.lookAt(lookAt);
      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    cam.position.set(5.6, -5.6, 11);
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
