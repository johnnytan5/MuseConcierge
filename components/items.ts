// Things a robot can carry, and the cabin camera that watches them. Procedural meshes at real
// size, z-up with the origin at the centre of the base, so SAM 3.1 has
// something to find in the cabin and something to miss once it is collected.
import * as THREE from 'three';

export const ITEM_KINDS = ['towel', 'shampoo', 'conditioner', 'food_bag', 'water', 'slippers', 'toothbrush'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

// The cabin floor in floor.xml, relative to the robot's chassis geom: the
// centre of the liner, 0.3 wide (x), 0.215 deep (y), 0.208 up to the ceiling.
const CABIN_FLOOR: [number, number, number] = [0, -0.0475, 0.212];
const CABIN_HEIGHT = 0.208;
// Travel sizes, picked so each item fits the cabin and stays whole in the
// close ceiling camera's frame (SAM 3.1 misses items that run off the frame).
const ITEM_SCALE: Record<ItemKind, number> = { towel: 0.62, shampoo: 0.8, conditioner: 0.8, food_bag: 0.58, water: 0.8, slippers: 0.8, toothbrush: 1 };

const FACING_CAMERA = -Math.PI / 2; // cylinder theta of the side an item shows the cabin camera

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Seeded so every visitor sees the same fabric.
function rng(seed: number) {
  return (a: number, b: number) => {
    seed = (seed * 16807) % 2147483647;
    return a + ((seed - 1) / 2147483646) * (b - a);
  };
}

const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// A solid of revolution around z, from [radius, height] points.
function lathe(points: [number, number][], segments = 40): THREE.BufferGeometry {
  return new THREE.LatheGeometry(points.map(([r, h]) => new THREE.Vector2(r, h)), segments).rotateX(Math.PI / 2);
}

function label(lines: string[], bg: string, ink: string, accent: string): THREE.CanvasTexture {
  return canvas(512, 512, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = accent;
    g.fillRect(0, 40, 512, 18);
    g.fillRect(0, 454, 512, 18);
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((text, i) => {
      g.font = i === 0 ? 'bold 74px Georgia, serif' : '34px Helvetica, Arial, sans-serif';
      g.fillText(text, 256, i === 0 ? 230 : 310 + (i - 1) * 46, 480);
    });
  });
}

// Curved label on the camera-facing side of a bottle of the given radius.
function wrapLabel(tex: THREE.Texture, r: number, h: number, z: number, arc = 2.0): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r, r, h, 32, 1, true, FACING_CAMERA - arc / 2, arc).rotateX(Math.PI / 2);
  const m = mesh(geo, std({ map: tex, roughness: 0.5 }), 0, 0, z);
  m.castShadow = false;
  return m;
}

function bottle(body: string, cap: string, tex: THREE.Texture, pump: boolean): THREE.Group {
  const g = new THREE.Group();
  const plastic = std({ color: body, roughness: 0.35 });
  const capMat = std({ color: cap, roughness: 0.3 });
  const shell = mesh(lathe([[0, 0], [0.03, 0], [0.034, 0.006], [0.034, 0.13], [0.03, 0.15], [0.017, 0.165], [0.017, 0.178], [0, 0.178]]), plastic);
  g.add(shell, wrapLabel(tex, 0.0348, 0.095, 0.07));
  if (pump) {
    g.add(mesh(lathe([[0, 0], [0.02, 0], [0.02, 0.016], [0.007, 0.018], [0.007, 0.05], [0, 0.05]]), capMat, 0, 0, 0.176));
    g.add(mesh(new THREE.BoxGeometry(0.058, 0.02, 0.012), capMat, 0.018, 0, 0.228));
  } else {
    g.add(mesh(lathe([[0, 0], [0.023, 0], [0.023, 0.03], [0.018, 0.034], [0, 0.034]]), capMat, 0, 0, 0.176));
  }
  return g;
}

// A folded bath towel: soft uneven layers, a woven band and a fringed end.
function towel(): THREE.Group {
  const r = rng(7);
  const pile = canvas(256, 256, (g) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 26000; i++) {
      const v = r(70, 190) | 0;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      g.arc(r(0, 256), r(0, 256), r(0.8, 2), 0, 2 * Math.PI);
      g.fill();
    }
  });
  pile.repeat.set(5, 4);
  const cloth = std({ color: '#aaa597', roughness: 1, bumpMap: pile, bumpScale: 6 });
  const g = new THREE.Group();
  const [len, wid, t] = [0.27, 0.2, 0.03];
  const wave = (x: number, y: number) => 0.0035 * Math.sin(x * 37 + y * 11) + 0.0025 * Math.sin(y * 53 - x * 19);
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.BoxGeometry(len, wid, t, 48, 36, 4);
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const [x, y, z] = [pos.getX(v), pos.getY(v), pos.getZ(v)];
      // Round the long edges like a fold and let the fabric sag unevenly.
      const edge = Math.max(0, Math.min(1, (wid / 2 - Math.abs(y)) / 0.014));
      pos.setZ(v, z * (0.45 + 0.55 * Math.sqrt(edge)) + wave(x + i * 0.3, y));
    }
    geo.computeVertexNormals();
    const layer = mesh(geo, cloth, (i - 1) * 0.004, (1 - i) * 0.003, t / 2 + i * (t - 0.003));
    g.add(layer);
  }
  const top = 3 * t - 0.002;
  const band = std({ color: '#2f5d8a', roughness: 1, bumpMap: pile, bumpScale: 1 });
  for (const x of [0.078, 0.092]) g.add(mesh(new THREE.BoxGeometry(0.008, wid - 0.004, 0.006), band, x, 0, top - 0.001));
  // Fringe over the near end, towards the camera.
  const thread = std({ color: '#a8a395', roughness: 1 });
  for (let i = 0; i < 44; i++) {
    const y = -wid / 2 + 0.005 + (i * (wid - 0.01)) / 43;
    const strand = mesh(new THREE.BoxGeometry(r(0.026, 0.036), 0.0028, 0.0016), thread, -len / 2 - 0.012, y, top - 0.006);
    strand.rotation.z = r(-0.22, 0.22);
    strand.rotation.y = 0.5;
    g.add(strand);
  }
  return g;
}

function foodBag(): THREE.Group {
  const r = rng(11);
  const green = '#1f9d55';
  const front = canvas(512, 640, (g) => {
    g.fillStyle = green;
    g.fillRect(0, 0, 512, 640);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 16;
    g.strokeStyle = '#fff';
    g.beginPath(); // a plain fork and spoon, no brand
    g.moveTo(210, 170); g.lineTo(210, 370);
    g.moveTo(180, 170); g.lineTo(180, 240); g.moveTo(240, 170); g.lineTo(240, 240);
    g.moveTo(180, 240); g.lineTo(240, 240);
    g.moveTo(305, 250); g.lineTo(305, 370);
    g.stroke();
    g.beginPath();
    g.ellipse(305, 205, 30, 45, 0, 0, 2 * Math.PI);
    g.fill();
    g.font = 'bold 66px Helvetica, Arial, sans-serif';
    g.fillText('FOOD', 256, 450);
    g.font = 'bold 44px Helvetica, Arial, sans-serif';
    g.fillText('DELIVERY', 256, 515);
  });
  const paper = std({ color: green, roughness: 0.85 });
  const printed = std({ map: front, roughness: 0.85 });
  // Built y-up so the print is upright, then stood on its base. Wrinkled by
  // nudging vertices, which keeps the box's flat, printable UVs.
  const [w, h, d] = [0.14, 0.2, 0.24];
  const geo = new THREE.BoxGeometry(w, h, d, 10, 14, 14);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const taper = 1 - 0.08 * (pos.getY(i) / h + 0.5);
    pos.setX(i, pos.getX(i) * taper + r(-0.0018, 0.0018));
    pos.setZ(i, pos.getZ(i) * taper + r(-0.0018, 0.0018));
  }
  geo.computeVertexNormals();
  geo.rotateX(Math.PI / 2);
  const g = new THREE.Group();
  g.add(mesh(geo, [paper, printed, paper, paper, paper, paper], 0, 0, h / 2));
  // Folded-over top and two paper handles.
  g.add(mesh(new THREE.BoxGeometry(0.13, 0.225, 0.028), std({ color: '#178647', roughness: 0.85 }), 0, 0, h + 0.012));
  const handle = std({ color: '#e8dfc8', roughness: 0.9 });
  for (const x of [-0.035, 0.035]) {
    const loop = new THREE.TorusGeometry(0.045, 0.005, 8, 24, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
    g.add(mesh(loop, handle, x, 0, h + 0.024));
  }
  return g;
}

function water(): THREE.Group {
  const g = new THREE.Group();
  const clear = new THREE.MeshPhysicalMaterial({ color: '#bfe3f5', roughness: 0.12, transparent: true, opacity: 0.62, clearcoat: 1 });
  g.add(mesh(lathe([[0, 0], [0.028, 0], [0.032, 0.006], [0.032, 0.14], [0.028, 0.165], [0.014, 0.195], [0.014, 0.205], [0, 0.205]]), clear));
  g.add(mesh(lathe([[0, 0], [0.0155, 0], [0.0155, 0.016], [0, 0.016]]), std({ color: '#1565c0', roughness: 0.35 }), 0, 0, 0.203));
  const tex = label(['Still', 'mineral water', '500 ml'], '#eaf6fd', '#0d47a1', '#1565c0');
  g.add(wrapLabel(tex, 0.0328, 0.06, 0.09, 2.3));
  return g;
}

function slipper(side: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  // Foot-shaped outline, toes at +x; the inner side is straighter than the outer.
  const s = new THREE.Shape();
  s.moveTo(-0.13, 0);
  s.bezierCurveTo(-0.13, side * 0.042, -0.07, side * 0.04, -0.01, side * 0.046);
  s.bezierCurveTo(0.06, side * 0.056, 0.14, side * 0.052, 0.14, side * 0.004);
  s.bezierCurveTo(0.14, -side * 0.042, 0.06, -side * 0.044, -0.01, -side * 0.036);
  s.bezierCurveTo(-0.07, -side * 0.034, -0.13, -side * 0.042, -0.13, 0);
  const extrude = (depth: number) => new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 16 });
  g.add(mesh(extrude(0.012), std({ color: '#55504a', roughness: 0.9 }))); // rubber sole
  const insole = mesh(extrude(0.006), std({ color: '#d2ccbf', roughness: 1 }), 0, 0, 0.012);
  insole.scale.set(0.97, 0.9, 1);
  g.add(insole);
  // Closed towelling toe: half an ellipsoid over the front of the foot.
  const dome = new THREE.SphereGeometry(1, 28, 12, 0, 2 * Math.PI, 0, Math.PI / 2).rotateX(Math.PI / 2);
  dome.scale(0.082, 0.056, 0.05);
  g.add(mesh(dome, std({ color: '#f0ece2', roughness: 1 }), 0.06, side * 0.004, 0.016));
  return g;
}

function slippers(): THREE.Group {
  const g = new THREE.Group();
  const [a, b] = [slipper(1), slipper(-1)];
  a.position.y = 0.062;
  b.position.y = -0.062;
  g.add(a, b);
  return g;
}

function toothbrush(): THREE.Group {
  const g = new THREE.Group();
  const handleMat = std({ color: '#1e88e5', roughness: 0.3 });
  const handle = new THREE.CapsuleGeometry(0.007, 0.15, 6, 14).rotateZ(Math.PI / 2);
  g.add(mesh(handle, handleMat, -0.015, 0, 0.008));
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.013, 0.006), handleMat, 0.07, 0, 0.008));
  const bristle = std({ color: '#fafafa', roughness: 0.8 });
  for (let i = 0; i < 6; i++) {
    for (const y of [-0.0035, 0.0035]) g.add(mesh(new THREE.BoxGeometry(0.003, 0.003, 0.012), bristle, 0.058 + i * 0.0048, y, 0.017));
  }
  g.rotation.z = 0.5;
  return g;
}

// Laid on its back for the ride, printed side up and top pointing away from
// the camera, so the print reads upright in the cabin camera's frame.
function laid(item: THREE.Group, length: number, height: number): THREE.Group {
  const g = new THREE.Group();
  item.rotation.y = Math.PI / 2;
  item.position.set(-length / 2, 0, height);
  g.add(item);
  return g;
}

export function buildItem(kind: ItemKind): THREE.Group {
  switch (kind) {
    case 'towel': return towel();
    case 'shampoo': return laid(bottle('#1b3a5c', '#d8dde3', label(['Shampoo', 'Daily care', '250 ml'], '#f4f1ea', '#1b3a5c', '#c9a75a'), false), 0.21, 0.035);
    case 'conditioner': return laid(bottle('#f0e4cf', '#9c7a3c', label(['Conditioner', 'Silk finish', '250 ml'], '#7a2e3a', '#f6efe3', '#c9a75a'), true), 0.24, 0.035);
    case 'food_bag': return laid(foodBag(), 0.25, 0.07);
    case 'water': return laid(water(), 0.22, 0.033);
    case 'slippers': return slippers();
    case 'toothbrush': return toothbrush();
  }
}

// The cabin as a frame on the robot's chassis mesh: holds the item, a small
// ceiling light and a wide camera over the back wall, looking down at the
// floor with the door at the top of the picture.
export type Cabin = { frame: THREE.Group; camera: THREE.PerspectiveCamera; setItem(kind: ItemKind | null): void };

export function buildCabin(chassis: THREE.Object3D, aspect: number, layer: number): Cabin {
  const frame = new THREE.Group();
  frame.position.set(...CABIN_FLOOR);
  chassis.add(frame);
  const light = new THREE.PointLight(0xfff4e0, 0.03, 0.8);
  light.position.set(0, 0, CABIN_HEIGHT - 0.02);
  light.layers.enableAll();
  frame.add(light);
  const camera = new THREE.PerspectiveCamera(78, aspect, 0.01, 5);
  camera.layers.set(layer);
  camera.up.set(0, -1, 0);
  camera.position.set(0, 0.1, CABIN_HEIGHT - 0.012);
  camera.lookAt(0, -0.015, 0); // before parenting, so this is in the cabin's own frame
  frame.add(camera);
  let item: THREE.Group | null = null;
  return {
    frame,
    camera,
    setItem(kind) {
      if (item) frame.remove(item);
      item = kind && new THREE.Group();
      if (!item || !kind) return;
      item.add(buildItem(kind));
      item.rotation.z = -Math.PI / 2; // an item's +x points at the door
      item.scale.setScalar(ITEM_SCALE[kind]);
      item.traverse((o) => o.layers.enable(layer));
      frame.add(item);
    },
  };
}
