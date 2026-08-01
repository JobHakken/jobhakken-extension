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
  viewport: { width: 1240, height: 1300 },
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
await cfg.close();
const p = await ctx.newPage();
await clearFrames(sw);
await p.goto('https://jobs.jobvite.com/egnyte/job/oLqLzfwf/apply', { waitUntil: 'domcontentloaded', timeout: 45000 });
await p.waitForTimeout(3500);
const tabId = await sw.evaluate(async () => {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return t.id;
});
const send = (fid) =>
  sw.evaluate(
    async (a) =>
      new Promise((res) => {
        chrome.tabs.sendMessage(
          a.tabId,
          { type: 'f2a-rpc', method: 'autofill', params: { mode: 'demo' } },
          a.fid != null ? { frameId: a.fid } : {},
          (x) => res(x),
        );
        setTimeout(() => res({ err: 'to' }), 60000);
      }),
    { tabId, fid },
  );
await send(0);
await p.waitForTimeout(2500); // pass 1: advance gate (top frame)
await clearFrames(sw);
await p.waitForTimeout(1500);
const tgt = await readTgt(sw);
if (tgt) await send(tgt.frameId); // pass 2: fill revealed form frame (popup retry)
await p.waitForTimeout(2000);
const vals = await p.evaluate(() => {
  const g = {};
  document.querySelectorAll('input[type=text],input[type=email],input[type=tel]').forEach((i) => {
    if (i.value) g[i.name || i.id] = i.value.slice(0, 28);
  });
  return g;
});
console.log('filled:', JSON.stringify(vals));
console.log(
  Object.keys(vals).length >= 3 ? 'JOBVITE GATE → FORM FILLED (single-click via popup retry) ✓' : 'not filled',
);
await ctx.close();
