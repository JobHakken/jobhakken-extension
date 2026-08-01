// Visual proof: load the extension, navigate to a job form, run autofill, screenshot the filled form.
// Usage:  SHOT_URL=<url> SHOT_OUT=/tmp/shots/x.png node e2e/tools/shot-fill.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const URL = process.env.SHOT_URL,
  OUT = process.env.SHOT_OUT || '/tmp/shots/shot.png';
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    '--headless=new',
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--disable-blink-features=AutomationControlled',
  ],
  viewport: { width: 1280, height: 1400 },
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
const extId = sw.url().split('/')[2];
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
await cfg.close();
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
await p.waitForTimeout(4000);
// dismiss cookie banners
await p
  .getByRole('button', { name: /accept|agree|got it|allow all/i })
  .first()
  .click({ timeout: 3000 })
  .catch(() => {});
await p.waitForTimeout(3000);
// autofill via best frame
const tgt = await sw.evaluate(async () => {
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
let res = { err: 'no form' };
if (tgt) {
  res = await sw.evaluate(
    async (t) =>
      new Promise((r) => {
        chrome.tabs.sendMessage(
          t.tabId,
          { type: 'f2a-rpc', method: 'autofill', params: { mode: 'demo' } },
          { frameId: t.frameId },
          (x) => r(chrome.runtime.lastError ? { err: chrome.runtime.lastError.message } : x),
        );
        setTimeout(() => r({ err: 'timeout' }), 60000);
      }),
    tgt,
  );
}
await p.waitForTimeout(2500);
await p.screenshot({ path: OUT, fullPage: true }).catch(() => p.screenshot({ path: OUT }));
console.log('RESULT:', JSON.stringify(res), '| fields:', tgt?.total ?? 0, '| shot:', OUT);
await ctx.close();
