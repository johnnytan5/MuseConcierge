// The robot's door camera. The overview shows a cut-away floor of flat
// coloured boxes; SAM 3.1 finds nothing in that. So the door camera renders a
// second layer of the same floor: full-height papered walls, carpet, wooden
// doors with brass number plates, at the same positions as the sim's geoms.
// Robots and fixtures from MuJoCo appear in both layers.
import * as THREE from 'three';
import { NODES } from '@/lib/fleet/nav.ts';
import { ROOMS } from '@/lib/hotel.ts';

export const PHOTO_LAYER = 1;
export const FRAME = { w: 640, h: 480 };

const WALL_Y = 2.0; // inner face of the north/south walls in floor.xml
const WALL_H = 2.6;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number] = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
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
  }, [26, 5]);
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
  }, [13, 4]);
  return { wood, wallpaper, carpet };
}

function plate(room: string) {
  return canvasTexture(256, 128, (g) => {
    g.fillStyle = '#c9a75a';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#1a1a1a';
    g.font = 'bold 84px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(room, 128, 68);
  });
}

function onPhotoLayer(o: THREE.Object3D) {
  o.layers.set(PHOTO_LAYER);
  return o;
}

export function buildDoorstep(scene: THREE.Scene): void {
  const tex = textures();
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(onPhotoLayer(m));
    return m;
  };

  add(new THREE.PlaneGeometry(13.4, 4.2), std({ map: tex.carpet, roughness: 1 }), 5.8, 0, 0.002);
  const wallMat = std({ map: tex.wallpaper, roughness: 0.9 });
  for (const s of [1, -1]) add(new THREE.BoxGeometry(13.3, 0.1, WALL_H), wallMat, 5.8, s * (WALL_Y + 0.05), WALL_H / 2);
  for (const x of [-0.85, 12.45]) add(new THREE.BoxGeometry(0.1, 4.2, WALL_H), wallMat, x, 0, WALL_H / 2);
  add(new THREE.PlaneGeometry(13.4, 4.2).rotateX(Math.PI), std({ color: '#f2efe8', roughness: 1 }), 5.8, 0, WALL_H);

  const frameMat = std({ color: '#efe9de', roughness: 0.5 });
  const doorMat = std({ map: tex.wood, roughness: 0.55 });
  const brass = std({ color: '#c0a060', metalness: 0.9, roughness: 0.25 });
  for (const room of ROOMS) {
    const [x, ny] = NODES[`door_${room}`];
    const s = Math.sign(ny); // +1 north wall, -1 south wall
    const face = s * (WALL_Y - 0.04);
    for (const [w, h, dx, z] of [[0.08, 2.18, -0.49, 1.09], [0.08, 2.18, 0.49, 1.09], [1.06, 0.08, 0, 2.14]]) {
      add(new THREE.BoxGeometry(w, 0.1, h), frameMat, x + dx, face, z);
    }
    add(new THREE.BoxGeometry(0.9, 0.05, 2.1), doorMat, x, face, 1.05);
    // Handle and plate on the guest's right as they face the door.
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 16).rotateZ(Math.PI / 2), brass, x + s * 0.33, face - s * 0.05, 1.0);
    const p = add(new THREE.PlaneGeometry(0.24, 0.12), std({ map: plate(room), metalness: 0.4, roughness: 0.4 }), x + s * 0.72, s * (WALL_Y - 0.005), 1.55);
    p.up.set(0, 0, 1);
    p.lookAt(x + s * 0.72, 0, 1.55);
  }
}

// A wide camera on the front of the robot's lid, tilted up at the door it
// stopped at (far enough forward that the lid itself stays out of frame).
export function doorCamera(robot: THREE.Vector3, room: string): THREE.PerspectiveCamera {
  const [x, ny] = NODES[`door_${room}`];
  const s = Math.sign(ny);
  const cam = new THREE.PerspectiveCamera(90, FRAME.w / FRAME.h, 0.05, 30);
  cam.layers.set(PHOTO_LAYER);
  cam.up.set(0, 0, 1);
  cam.position.set(robot.x, robot.y + s * 0.2, 0.7);
  cam.lookAt(x, s * WALL_Y, 1.05);
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
