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
const beforeFields = await p.evaluate(() => document.querySelectorAll('input:not([type=hidden]),select').length);
console.log('before autofill: visible fields =', beforeFields, '(gate = few fields)');
// trigger autofill (which now auto-advances the gate first)
let tgt = null;
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(1000);
  tgt = await readTgt(sw);
  if (tgt) break;
}
if (!tgt) {
  // gate present → frameStore may show the 1 dropdown; send autofill to the tab
  tgt = {
    tabId: await sw.evaluate(async () => {
      const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return t.id;
    }),
    frameId: 0,
    total: 1,
  };
}
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
await p.waitForTimeout(2500);
const afterFields = await p.evaluate(() => document.querySelectorAll('input:not([type=hidden]),select').length);
const gateVal = await p.evaluate(() => {
  const s = document.querySelector('select#jv-country-select,select[name=jv-country-select]');
  return s ? s.options[s.selectedIndex]?.text : '(no gate select)';
});
console.log('gate now selected:', gateVal);
console.log('after autofill: visible fields =', afterFields, '· fill result:', JSON.stringify(r));
console.log(afterFields > beforeFields ? 'GATE AUTO-ADVANCED — form revealed ✓' : 'form not revealed');
await ctx.close();
