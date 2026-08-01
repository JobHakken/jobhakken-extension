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
const rpc = (sw, t, m, params) =>
  sw.evaluate(
    async (a) =>
      new Promise((res) => {
        chrome.tabs.sendMessage(
          a.tabId,
          { type: 'f2a-rpc', method: a.m, params: a.params || { mode: 'demo' } },
          { frameId: a.frameId },
          (x) => res(x),
        );
        setTimeout(() => res({ err: 'to' }), 60000);
      }),
    { ...t, m, params },
  );
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--disable-blink-features=AutomationControlled',
  ],
  viewport: { width: 1280, height: 1400 },
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
await cfg.close();
const p = await ctx.newPage();
await clearFrames(sw);
await p.goto('https://jobs.ashbyhq.com/replit/47235851-fadd-4bd7-9cc6-61f545059ac1/application', {
  waitUntil: 'domcontentloaded',
  timeout: 45000,
});
let tgt = null;
for (let i = 0; i < 20; i++) {
  await p.waitForTimeout(1000);
  tgt = await readTgt(sw);
  if (tgt && tgt.total >= 3) break;
}
await rpc(sw, tgt, 'autofill');
await p.waitForTimeout(1000);
const d = await rpc(sw, tgt, 'draft');
console.log('draft:', JSON.stringify(d));
const list = await rpc(sw, tgt, 'draftedList', {});
console.log('draftedList:', JSON.stringify(list));
const label = list?.items?.[0]?.label;
const before = await p.evaluate(() => document.querySelector('textarea')?.value?.slice(0, 45));
const re = await rpc(sw, tgt, 'redraft', { label, instruction: 'make it one sentence and mention Python' });
await p.waitForTimeout(800);
const after = await p.evaluate(() => document.querySelector('textarea')?.value?.slice(0, 80));
console.log('before:', JSON.stringify(before));
console.log('after :', JSON.stringify(after));
console.log(
  re?.ok && after && after !== before
    ? 'PER-FIELD REDRAFT works — value changed per instruction ✓'
    : 'redraft did not update',
);
await ctx.close();
