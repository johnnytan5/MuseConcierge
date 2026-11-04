// The robot's door camera. The overview shows flat coloured boxes; SAM 3.1
// finds nothing in that. So the cameras render a second layer of the same
// floor, built from its own geoms: papered walls, carpet, wooden doors with
// brass number plates. Robots and fixtures from MuJoCo appear in both layers.
import * as THREE from 'three';
import { DOOR_FACES, NODES } from '@/lib/fleet/nav.ts';
import { ROOMS } from '@/lib/hotel.ts';
import type { GeomInfo } from '@/lib/sim/protocol.ts';

export const PHOTO_LAYER = 1;
const DOOR_LAYER = 2; // closed room doors, seen only by the robot's door photo
export const FRAME = { w: 640, h: 480 };

const WALL_H = 1.25; // the sim's walls are 1 m; the photo walls reach a ceiling
const STOP_TO_DOOR = 0.55; // m from a robot's stop to the room door (nav.ts door_* nodes)

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Seeded so every visitor sees the same wood grain and carpet.
function rng(seed: number) {
  return (a: number, b: number) => {
    seed = (seed * 16807) % 2147483647;
    return a + ((seed - 1) / 2147483646) * (b - a);
  };
}

function textures() {
  const r = rng(42);
  const wood = canvasTexture(512, 1024, (g) => {
    g.fillStyle = '#6b4a2e';
    g.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = `rgba(${r(40, 90) | 0},${r(25, 55) | 0},${r(10, 30) | 0},${r(0.15, 0.4)})`;
      g.lineWidth = r(1, 4);
      const x = r(0, 512);
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + r(-20, 20), 340, x + r(-20, 20), 680, x + r(-10, 10), 1024);
      g.stroke();
    }
    g.strokeStyle = 'rgba(30,18,8,.6)'; // two recessed panels
    g.lineWidth = 10;
    g.strokeRect(70, 80, 372, 430);
    g.strokeRect(70, 532, 372, 410);
  });
  const wallpaper = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#d9cfbf';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(160,140,110,.25)';
    for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 6, 256);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(0,0,0,${r(0, 0.04)})`;
      g.fillRect(r(0, 256), r(0, 256), 2, 2);
    }
  });
  const carpet = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#5a1f24';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${r(60, 140) | 0},${r(20, 50) | 0},${r(20, 50) | 0},.5)`;
      g.fillRect(r(0, 256), r(0, 256), 2, 2);
    }
    g.strokeStyle = 'rgba(200,160,90,.5)';
    g.lineWidth = 6;
    g.strokeRect(40, 40, 176, 176);
  });
  return { wood, wallpaper, carpet };
}

function plate(room: string) {
  return canvasTexture(256, 128, (g) => {
    g.fillStyle = '#c9a75a';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#1a1a1a';
    g.font = 'bold 78px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(room, 128, 68);
  });
}

const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);

// A texture tiled to a real size, sharing its image.
function tiled(t: THREE.Texture, u: number, v: number) {
  const c = t.clone();
  c.repeat.set(u, v);
  c.needsUpdate = true;
  return c;
}

function photoMesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  m.layers.set(PHOTO_LAYER);
  return m;
}

// A plane facing +y with its top towards +z.
const facing = (w: number, h: number) => new THREE.PlaneGeometry(w, h).rotateX(Math.PI / 2).rotateZ(Math.PI);

function doorAssembly(room: string, wood: THREE.Texture): THREE.Group {
  // Local frame: x along the wall, +y towards the corridor, z up. Seen from
  // the corridor, local -x is to the viewer's right.
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = photoMesh(geo, mat, x, y, z);
    g.add(m);
    return m;
  };
  const frame = std({ color: '#efe9de', roughness: 0.5 });
  for (const x of [-0.2, 0.2]) add(new THREE.BoxGeometry(0.03, 0.06, 1.03), frame, x, 0.01, 0.515);
  add(new THREE.BoxGeometry(0.43, 0.06, 0.03), frame, 0, 0.01, 1.015);
  // The door itself: the guest's view looks out through this opening, so it
  // sits on a layer only the robot's door photo uses.
  const leaf = [
    add(new THREE.BoxGeometry(0.38, 0.03, 1), std({ color: '#4a3220', roughness: 0.6 }), 0, 0, 0.5),
    add(facing(0.38, 1), std({ map: wood, roughness: 0.55 }), 0, 0.017, 0.5),
    add(new THREE.CylinderGeometry(0.009, 0.009, 0.08, 14).rotateZ(Math.PI / 2), std({ color: '#c0a060', metalness: 0.9, roughness: 0.25 }), -0.13, 0.035, 0.48),
  ];
  for (const m of leaf) m.layers.set(DOOR_LAYER);
  add(facing(0.14, 0.07), std({ map: plate(room), metalness: 0.4, roughness: 0.4 }), -0.32, 0.028, 0.76);
  return g;
}

export function buildDoorstep(scene: THREE.Scene, geoms: GeomInfo[]): void {
  const tex = textures();
  for (const g of geoms) {
    const [sx, sy, sz] = g.size;
    const [x, y] = g.pos;
    if (g.name.startsWith('wall_')) {
      const paper = tiled(tex.wallpaper, Math.max(sx, sy) * 2 / 0.3, WALL_H / 0.3);
      scene.add(photoMesh(new THREE.BoxGeometry(2 * sx, 2 * sy, WALL_H), std({ map: paper, roughness: 0.9 }), x, y, WALL_H / 2));
    } else if (g.name.startsWith('carpet_')) {
      const pile = tiled(tex.carpet, sx * 2 / 0.5, sy * 2 / 0.5);
      scene.add(photoMesh(new THREE.BoxGeometry(2 * sx, 2 * sy, 2 * sz), std({ map: pile, roughness: 1 }), x, y, g.pos[2]));
    }
  }
  scene.add(photoMesh(new THREE.PlaneGeometry(16, 12).rotateX(Math.PI), std({ color: '#f2efe8', roughness: 1 }), 1.35, 0.85, WALL_H));

  for (const room of ROOMS) {
    const door = geoms.find((g) => g.name === `door_${room}`);
    if (!door) continue;
    const [nx, ny] = DOOR_FACES[`door_${room}`]; // from the corridor into the room
    const assembly = doorAssembly(room, tex.wood);
    assembly.position.set(door.pos[0], door.pos[1], 0);
    assembly.rotation.z = Math.atan2(-ny, -nx) - Math.PI / 2;
    scene.add(assembly);
  }
}

// A wide camera on a short mast over the robot's dome, looking at the door it stopped at.
export function doorCamera(robot: THREE.Vector3, room: string): THREE.PerspectiveCamera {
  const id = `door_${room}`;
  const [nx, ny] = DOOR_FACES[id];
  const [sx, sy] = NODES[id];
  const cam = new THREE.PerspectiveCamera(92, FRAME.w / FRAME.h, 0.05, 30);
  cam.layers.set(PHOTO_LAYER);
  cam.up.set(0, 0, 1);
  cam.layers.enable(DOOR_LAYER);
  cam.position.set(robot.x + nx * 0.13, robot.y + ny * 0.13, 1.02);
  cam.lookAt(sx + nx * STOP_TO_DOOR, sy + ny * STOP_TO_DOOR, 0.58);
  return cam;
}

// A guest standing just inside the room, looking out through the open doorway.
export function guestCamera(room: string): THREE.PerspectiveCamera {
  const id = `door_${room}`;
  const [nx, ny] = DOOR_FACES[id];
  const [sx, sy] = NODES[id];
  const cam = new THREE.PerspectiveCamera(70, FRAME.w / FRAME.h, 0.05, 30);
  cam.layers.set(PHOTO_LAYER);
  cam.up.set(0, 0, 1);
  cam.position.set(sx + nx * (STOP_TO_DOOR + 0.42), sy + ny * (STOP_TO_DOOR + 0.42), 0.82);
  cam.lookAt(sx, sy, 0.46);
  return cam;
}

// Render one frame from cam into a JPEG data URL, off screen.
export function captureJpeg(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera): string {
  const target = new THREE.WebGLRenderTarget(FRAME.w, FRAME.h, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
  const px = new Uint8Array(FRAME.w * FRAME.h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, FRAME.w, FRAME.h, px);
  renderer.setRenderTarget(prev);
  target.dispose();

  const c = document.createElement('canvas');
  c.width = FRAME.w;
  c.height = FRAME.h;
  const img = c.getContext('2d')!.createImageData(FRAME.w, FRAME.h);
  const row = FRAME.w * 4;
  for (let y = 0; y < FRAME.h; y++) img.data.set(px.subarray((FRAME.h - 1 - y) * row, (FRAME.h - y) * row), y * row); // GL rows are bottom-up
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}
