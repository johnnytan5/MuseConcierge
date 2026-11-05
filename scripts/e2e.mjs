// End to end against the running dev server, with real models: a recorded
// guest call goes in through Chrome's fake microphone, then Muse Voice
// Transcribe → Muse Spark → fleet → Muse Wonder → battery fault → handoff →
// door and cabin photos → SAM 3.1 → "Mimic collection" → SAM 3.1 → delivered.
// The agent's voice is real AssemblyAI TTS; the browser fallback is only
// counted, and must stay at zero. Needs macOS Chrome.
//
//   npm run dev                         # in another terminal
//   node --env-file=.env scripts/e2e.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.E2E_URL ?? 'http://localhost:3000/?demo=1';
const ROOM = '1204';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });

const portOpen = (port) => new Promise((ok) => {
  const c = createConnection(port, '127.0.0.1');
  c.on('connect', () => { c.destroy(); ok(true); });
  c.on('error', () => ok(false));
});

let relay = null;
if (!(await portOpen(8787))) {
  relay = spawn(process.execPath, ['scripts/asr-relay.mjs'], { stdio: 'ignore', env: process.env });
  await new Promise((r) => setTimeout(r, 800));
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${resolve('bench/clips/e2e-call.wav')}%noloop`,
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__browserVoice = 0;
  speechSynthesis.speak = (u) => { window.__browserVoice++; setTimeout(() => u.onend?.(new Event('end')), 45 * u.text.length); };
  window.__tones = 0;
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...a) { window.__tones++; return start.apply(this, a); };
});

let callId = null;
let ttsAudio = 0;
page.on('response', async (r) => {
  if (r.url().endsWith('/api/tts') && r.ok()) ttsAudio++;
  if (r.url().endsWith('/api/call/start')) callId = (await r.json().catch(() => ({}))).callId ?? callId;
});

const t0 = Date.now();
let failed = false;
const pass = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ok  ${m}`);
const shot = (n) => (shots ? page.screenshot({ path: `${shots}/${n}.png` }) : null);
const text = (sel) => page.locator(sel).innerText();

// Wait for a regex to appear in an element's text, or fail the run.
async function see(sel, re, what, timeout = 60000) {
  await page.waitForFunction(([s, src]) => [...document.querySelectorAll(s)].some((el) => new RegExp(src, 'is').test(el.innerText)), [sel, re.source], { timeout, polling: 250 })
    .catch(async () => { throw new Error(`${what}: no ${re} in ${sel}\n--- page ---\n${(await page.locator('body').innerText()).slice(0, 1500)}`); });
  pass(what);
}

try {
  await page.goto(URL);
  await page.waitForFunction(() => !document.querySelector('.call button')?.disabled, null, { timeout: 60000 });
  const clean = () => page.evaluate(async () => { const s = await window.__fleet.getSnapshot(); return s.tasks.length === 0 && s.robots.every((r) => !r.taskId); });
  if (!(await clean())) throw new Error('a fresh start should have no tasks');
  pass('fresh start: no tasks, robots parked');
  await page.waitForTimeout(1500);

  // A room that isn't the default, to prove the dropdown drives everything.
  await page.locator('.calling-from select').selectOption(ROOM);
  await page.getByRole('button', { name: 'Call the front desk' }).click();
  await see('.transcript', /towel/, 'guest order transcribed by Muse', 30000);
  await see('.transcript', /create_task/, 'Muse Spark placed the order without asking for the room', 45000);
  if (/which room|what room|your room number/i.test(await text('.transcript'))) throw new Error('the agent asked for the room');
  if (!new RegExp(`"room":"${ROOM}"`).test(await text('.transcript'))) throw new Error('the order did not go to the room the call came from');
  console.log(`\n--- call ---\n${await text('.transcript')}\n------------\n`);
  await see('.tasks', /towel \+ .*uber|uber.* \+ .*towel/, 'one task carries the towel and the Uber Eats order');
  await see('.transcript', /anything else/i, 'agent asks if there is anything else', 30000);
  await see('.transcript', /Call ended/, 'guest says no, the agent ends the call', 60000);

  if ((await page.evaluate(() => window.__browserVoice)) !== 0) throw new Error('the browser voice was used: AssemblyAI TTS failed');
  if (ttsAudio < 2) throw new Error(`expected spoken replies through /api/tts, got ${ttsAudio}`);
  pass(`agent spoke ${ttsAudio} lines with AssemblyAI TTS`);
  await see('.brainlog', /New order t1.*Muse Wonder/, 'Muse Wonder assigned the order');
  const loaded = page.getByRole('button', { name: 'Bin loaded — send it' });
  await loaded.waitFor({ timeout: 45000 });
  await loaded.click();
  pass('robot 1 loaded at the desk with Bin loaded');
  await see('.stage .plan', /Hand off to robot \d.*Muse Wonder/, 'battery fault: plan card shows the options and Wonder\'s pick', 90000);
  if ((await page.evaluate(() => window.__tones)) !== 6) throw new Error('the fault should play the alert once (6 tones)');
  pass('fault alert sounded once');
  const plan = await text('.stage .plan');
  console.log(`\n--- plan ---\n${plan}\n------------\n`);
  if (!/Charge first/.test(plan)) throw new Error('plan card is missing options or steps');
  if (!(await page.locator('.stage .plan .chosen').innerText()).includes('Hand off')) throw new Error('chosen option is not the handoff');
  await shot('1-brain-plan');
  await page.locator('.stage .plan .close').click();
  await loaded.waitFor({ timeout: 45000 });
  await shot('1b-bin-loaded');
  await loaded.click();
  pass('the other robot loaded at the desk with Bin loaded');

  await see('.stage .povtag', new RegExp(`Guest.s view, room ${ROOM}`), 'stage switches to the guest\'s view on arrival', 120000);
  await shot('2a-guest-door-closed');
  await page.waitForTimeout(2000);
  await shot('2b-guest-door-opening');
  await page.waitForTimeout(1500);
  await shot('2c-guest-door-open');

  await see('.stage .povtag', /Robot \d cabin camera/, 'then to the cabin camera');
  await see('.stage .tip', /Picture taken.*SAM 3\.1/, 'cabin photo: flash and tooltip');
  await see('.checks', /Right door/, 'room number check: SAM boxes, Spark read the plate', 30000);
  await see('.checks', /towel \d\.\d+.*food bag \d\.\d+|food bag \d\.\d+.*towel \d\.\d+/, 'SAM sees both items in the cabin', 30000);
  await shot('3-cabin-before');
  if ((await page.locator('.robot-actions .checks figure:nth-child(2) .samBox').count()) !== 2) throw new Error('expected one SAM box per item');
  if (await page.getByRole('button', { name: /^Cameras/ }).count()) throw new Error('there should be no Cameras tab');

  await page.locator('.stage .tip .close').click();
  if (await page.locator('.stage .tip').count()) throw new Error('tooltip did not dismiss');
  pass('tooltip dismisses');

  const button = page.getByRole('button', { name: 'Mimic collection' });
  // It must wait for the person at the left panel, however long they take.
  await page.waitForTimeout(8000);
  if (!/at door/.test(await text('.tasks:not(.stock)'))) throw new Error('task should still wait at the door');
  if (!/cabin camera/.test(await text('.stage .povtag'))) throw new Error('stage should stay on the cabin camera while waiting');
  pass('robot waits on the cabin camera for the action on the left');
  if (await button.isDisabled()) throw new Error('Mimic collection is disabled at the door');
  const box = await button.boundingBox();
  if (!box || box.y + box.height > page.viewportSize().height) throw new Error('Mimic collection is off screen');
  if (!/at door/.test(await text('.tasks:not(.stock)'))) throw new Error('task should wait at the door');
  await button.click();
  await page.waitForTimeout(700);
  await shot('4-collecting');
  await see('.checks', /Cabin empty/, 'SAM confirms the cabin is empty', 45000);
  await shot('5-cabin-after');
  await see('.tasks', /collected/, 'task completes only after the empty cabin');
  await see('.live-flow', new RegExp(`Who.*Guest in ${ROOM}.*What it did.*Order handling.*Fleet planning.*Delivery checks.*Result.*Order placed.*Handed to another robot.*Collected by the guest`), 'live call shows What happened', 15000);
  await page.locator('.live-flow').scrollIntoViewIfNeeded();
  await shot('5b-live-what-happened');
  await see('.notes', /Collected/, 'room notified');
  await see('.panel', /Robot \d\s*Returning/, 'the robot closes up and leaves', 20000);
  // Nothing may still offer an action for a delivery that is over.
  if (await page.getByRole('button', { name: /Mimic collection|Check the cabin again/ }).count()) throw new Error('a finished delivery still offers Mimic collection');
  await see('.robot-actions', new RegExp(`Last delivery, room ${ROOM}: collected`), 'finished delivery shows as the last delivery');

  // The call's complete record, from the shared database.
  await page.getByRole('button', { name: /^Call log/ }).click();
  await see('.callrow', /towels/, 'call appears in the list of past calls', 15000);
  await page.locator('.callrow', { hasText: /towels/ }).first().click();
  await see('.flow', /Who.*Assistant.*Fleet brain.*Delivery robot.*What it did.*Order handling.*Fleet planning.*Hand-overs.*Delivery checks.*Result.*Order placed.*Handed to another robot.*Collected by the guest/, 'call opens with the flow graph', 15000);
  await see('.callsteps', /Room service.*towels.*Placed an order.*Brain decision.*Bin loaded.*Room number check.*Cabin check.*Guest collected/, 'then the conversation and actions in order', 15000);
  await shot('7-call-log');
  await page.getByRole('button', { name: 'Close' }).click();
  await shot('7b-call-list');
  await page.getByRole('button', { name: /^Inventory/ }).click();
  await see('.ledger', /towel.*−2.*create_task/, 'stock ledger records the two towels', 15000);
  await shot('8-inventory');
  await page.getByRole('button', { name: /^Escalations/ }).click();
  const reason = `e2e check ${Date.now()}`;
  const made = await page.evaluate(([callId, why]) => fetch('/api/escalations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callId, reason: why, room: '804' }) }).then((r) => r.ok), [callId, reason]);
  if (!made) throw new Error('could not create an escalation');
  await see('.escalation', new RegExp(reason), 'escalation appears in the tab', 15000);
  await page.locator('.escalation', { hasText: reason }).getByRole('button', { name: 'Resolve' }).click();
  await page.getByRole('button', { name: 'Resolved', exact: true }).click();
  await see('.escalation.resolved', new RegExp(reason), 'escalation resolves', 15000);
  await shot('9-escalations');
  await page.getByRole('button', { name: /^Fleet/ }).click();
  await see('.robot_1', /Docked|Charging/, 'robot 1 is home', 170000);
  await see('.robot_2', /Docked|Charging/, 'robot 2 is home', 170000);
  const pcts = async () => Promise.all(['.robot_1', '.robot_2'].map(async (r) => Number((await text(`${r} .battery`)).replace('%', ''))));
  const before = await pcts();
  await page.waitForTimeout(16000);
  const after = await pcts();
  if (!after.some((p, i) => p > before[i])) throw new Error(`a docked robot should be charging: ${before} -> ${after}`);
  pass('docked robot\'s battery is rising');
  await shot('11-home');
  await shot('6-done');
  await page.getByRole('button', { name: /^Live call/ }).click();
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await see('.call', /Waiting for a call/, 'Reset demo clears the call log');
  if (await page.locator('.live-flow').count()) throw new Error('Reset demo left What happened on screen');
  await page.waitForFunction(async () => { const s = await window.__fleet.getSnapshot(); return s.tasks.length === 0 && s.robots.every((r) => !r.taskId); }, null, { timeout: 5000 });
  pass('Reset demo leaves no tasks and parked robots');
  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
  console.log(`\nPASS in ${Math.round((Date.now() - t0) / 1000)} s`);
} catch (e) {
  failed = true;
  await shot('failed').catch(() => {});
  console.error(`\nFAIL: ${e.message}`);
} finally {
  const visitor = await page.evaluate(() => localStorage.getItem('muse-visitor')).catch(() => null);
  await browser.close();
  relay?.kill();
  // The run's records are test data: remove them and put the stock back.
  if (process.env.SUPABASE_URL) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const db = (path, init = {}) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }).catch(() => null);
    if (visitor) await db(`muse_fleet_state?id=eq.${visitor}`, { method: 'DELETE' });
    if (callId) {
      const res = await db(`inventory_audit_log?select=id,item_id,delta&task_id=like.${callId.slice(-6)}-*`);
      for (const row of (await res?.json()) ?? []) {
        const [item] = await (await db(`inventory_items?select=stock_count&id=eq.${row.item_id}`)).json();
        if (item.stock_count !== null) await db(`inventory_items?id=eq.${row.item_id}`, { method: 'PATCH', body: JSON.stringify({ stock_count: item.stock_count - row.delta }) });
        await db(`inventory_audit_log?id=eq.${row.id}`, { method: 'DELETE' });
      }
      await db(`tool_call_events?session_id=eq.${callId}`, { method: 'DELETE' });
      await db(`voice_sessions?id=eq.${callId}`, { method: 'DELETE' });
    }
    await db('frontdesk_escalations?reason=like.e2e check*', { method: 'DELETE' });
  }
}
process.exit(failed ? 1 : 0);
