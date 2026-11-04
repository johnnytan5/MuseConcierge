// End to end against the running dev server, with real models: a recorded
// guest call goes in through Chrome's fake microphone, then Muse Voice
// Transcribe → Muse Spark → fleet → Muse Wonder → battery fault → handoff →
// door and cabin photos → SAM 3.1 → "Mimic collection" → SAM 3.1 → delivered.
// Speech output is stubbed (headless Chrome has no voices). Needs macOS Chrome.
//
//   npm run dev                         # in another terminal
//   node --env-file=.env scripts/e2e.mjs [screenshot-dir]
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.E2E_URL ?? 'http://localhost:3000/?demo=1';
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
  speechSynthesis.speak = (u) => setTimeout(() => u.onend?.(new Event('end')), 45 * u.text.length);
});

let callId = null;
page.on('response', async (r) => {
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
  await see('.notes, .tasks', /hk1|linen/, 'housekeeping already running on robot 2');
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: 'Call the front desk' }).click();
  await see('.transcript', /towel/, 'guest order transcribed by Muse', 30000);
  await see('.transcript', /create_task/, 'Muse Spark called create_task after the read-back', 45000);
  console.log(`\n--- call ---\n${await text('.transcript')}\n------------\n`);
  await see('.tasks', /towel \+ .*uber|uber.* \+ .*towel/, 'one task carries the towel and the Uber Eats order');
  await see('.transcript', /Call ended/, 'call ended by the agent', 30000);

  await see('.brainlog', /New order t1.*Muse Wonder/, 'Muse Wonder assigned the order');
  await see('.stage .plan', /Hand off to robot 2.*Muse Wonder/, 'battery fault: plan card shows the options and Wonder\'s pick', 90000);
  const plan = await text('.stage .plan');
  console.log(`\n--- plan ---\n${plan}\n------------\n`);
  if (!/Charge first/.test(plan) || !/pauses hk1/.test(plan)) throw new Error('plan card is missing options or steps');
  if (!(await page.locator('.stage .plan .chosen').innerText()).includes('Hand off')) throw new Error('chosen option is not the handoff');
  await shot('1-brain-plan');
  await page.locator('.stage .plan .close').click();

  await see('.stage .povtag', /Robot 2 door camera/, 'stage switches to the door camera on arrival', 120000);
  await see('.stage .tip', /Picture taken.*SAM 3\.1/, 'door photo: flash and tooltip');
  await see('.panel', /Right door/, 'door check: SAM boxes, Spark read the plate', 30000);
  await shot('2-door-camera');

  await see('.stage .povtag', /Robot 2 cabin camera/, 'stage switches to the cabin camera');
  await see('.stage .result', /towel \d\.\d+.*food bag \d\.\d+|food bag \d\.\d+.*towel \d\.\d+/, 'SAM sees both items in the cabin', 30000);
  await shot('3-cabin-before');
  if ((await page.locator('.stage .result .samBox').count()) !== 2) throw new Error('expected one SAM box per item');

  await page.locator('.stage .tip .close').click();
  if (await page.locator('.stage .tip').count()) throw new Error('tooltip did not dismiss');
  pass('tooltip dismisses');

  const button = page.getByRole('button', { name: 'Mimic collection' });
  if (await button.isDisabled()) throw new Error('Mimic collection is disabled at the door');
  const box = await button.boundingBox();
  if (!box || box.y + box.height > page.viewportSize().height) throw new Error('Mimic collection is off screen');
  if (!/at door/.test(await text('.tasks:not(.stock)'))) throw new Error('task should wait at the door');
  await button.click();
  await page.waitForTimeout(700);
  await shot('4-collecting');
  await see('.stage .result', /Cabin empty/, 'SAM confirms the cabin is empty', 45000);
  await shot('5-cabin-after');
  await see('.tasks', /collected/, 'task completes only after the empty cabin');
  await see('.notes', /Collected/, 'room notified');
  await see('.panel', /Robot 2\s*Returning/, 'robot 2 closes up and leaves', 20000);
  await see('.brainlog', /hk1 resumed/, 'brain resumes housekeeping', 90000);

  // The call's complete record, from the shared database.
  await page.getByRole('button', { name: /^Call log/ }).click();
  await page.locator('.callrow', { hasText: /towels/ }).first().click();
  await see('.timeline', /Guest.*Agent.*create_task.*brain_decision.*door_check.*cabin_check.*collection/, 'call log shows the conversation, tools and fleet actions in order', 15000);
  await shot('7-call-log');
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
  // Housekeeping resumes after the order, then robot 2 must come home by itself.
  await page.getByRole('button', { name: /^Fleet/ }).click();
  await see('.robot_2', /On housekeeping, back in/, 'robot 2 parks at 1205 with a visible countdown', 45000);
  await shot('10-housekeeping');
  await see('.robot_2', /Docked/, 'housekeeping ends and robot 2 returns to its dock', 170000);
  await shot('11-home');
  await shot('6-done');
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
