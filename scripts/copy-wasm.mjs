// Serves MuJoCo's JS loader and wasm from public/sim. The worker imports the
// loader by URL at runtime: bundling it fails on its Node-only branch
// (`import('module')`).
import { copyFileSync } from 'node:fs';
for (const f of ['mujoco.js', 'mujoco.wasm']) copyFileSync(`node_modules/@mujoco/mujoco/${f}`, `public/sim/${f}`);
