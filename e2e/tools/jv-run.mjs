import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const clearFrames = async (sw) =>
  sw.evaluate(async () => {
    const s = await chrome.storage.session.get(null);
    for (const k of Object.keys(s)) if (k.startsWith('f2a_frames:')) await chrome.storage.session.remove(k);
  });
const readTgt = async (sw) =>
  sw.evaluate(async () => {
    const s = await chrome.storage.session.get(null);
    let t = null;
    for (const [k, c] of Object.entries(s)) {
      if (!k.startsWith('f2a_frames:')) continue;
      const id = Number(k.split(':')[1]);
      let b = null;
      for (const [f, n] of Object.entries(c)) if (n > 0 && (!b || n > b.count)) b = { frameId: Number(f), count: n };
      const tot = Object.values(c).reduce((a, x) => a + x, 0);
      if (b && (!t || tot > t.total)) t = { tabId: id, frameId: b.frameId, total: tot };
    }
    return t;
  });
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--disable-blink-features=AutomationControlled',
  ],
  viewport: { width: 1240, height: 1400 },
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
await cfg.close();
const p = await ctx.newPage();
await clearFrames(sw);
await p.goto(process.argv[2], { waitUntil: 'domcontentloaded', timeout: 45000 });
await p.waitForTimeout(3500);
// consent gate: pick the policy option (2nd), accept any resulting consent, wait for form
const sel = p.locator('select#jv-country-select, select[name=jv-country-select]').first();
if (await sel.count()) {
  const opts = await sel.locator('option').allTextContents();
  const idx = opts.findIndex((o) => /policy|global|united states|english/i.test(o));
  await sel.selectOption({ index: idx > 0 ? idx : 1 });
  console.log('selected residence:', opts[idx > 0 ? idx : 1]);
  await p.waitForTimeout(2500);
}
// accept consent (checkbox + agree/accept/continue)
await p
  .locator('input[type=checkbox]')
  .first()
  .check({ timeout: 2500 })
  .catch(() => {});
await p
  .getByRole('button', { name: /agree|accept|continue|proceed|i consent|next/i })
  .first()
  .click({ timeout: 4000 })
  .catch(() => {});
await p
  .getByText(/i agree|accept|continue|proceed/i)
  .first()
  .click({ timeout: 2500 })
  .catch(() => {});
await p.waitForTimeout(4000);
let tgt = null;
for (let i = 0; i < 18; i++) {
  await p.waitForTimeout(1000);
  tgt = await readTgt(sw);
  if (tgt && tgt.total >= 3) break;
}
if (tgt) {
  const r = await sw.evaluate(
    async (t) =>
      new Promise((res) => {
        chrome.tabs.sendMessage(
          t.tabId,
          { type: 'f2a-rpc', method: 'autofill', params: { mode: 'demo' } },
          { frameId: t.frameId },
          (x) => res(x),
        );
        setTimeout(() => res({ err: 'to' }), 60000);
      }),
    tgt,
  );
  console.log('FILLED', r?.filled, '/', tgt.total);
} else
  console.log(
    'still no form after consent — body:',
    await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160)),
  );
await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/shots/jobvite-NinjaOne.png', fullPage: true }).catch(() => {});
await ctx.close();
