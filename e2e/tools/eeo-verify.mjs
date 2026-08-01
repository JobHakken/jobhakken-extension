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
  viewport: { width: 1280, height: 1500 },
});
let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 60000 }));
const extId = sw.url().split('/')[2];
// TEST MODE ON → the built-in TEST_PROFILE (which HAS gender/race/veteran/disability)
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
console.log('autofilled', r?.filled, '/', tgt.total);
await p.waitForTimeout(1500);
// report the CHECKED state of the EEO radio groups by their option label
const eeo = await p.evaluate(() => {
  const groups = {};
  document.querySelectorAll('input[type=radio]:checked').forEach((el) => {
    const lab = (el.closest('label')?.innerText || el.getAttribute('aria-label') || '').trim();
    const q = (el.closest('fieldset')?.querySelector('legend,label')?.innerText || el.name || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    groups[q || lab] = lab;
  });
  // also grab the visible text of the Gender/Race/Veteran sections' selected buttons (Ashby uses styled radios)
  const pick = (kw) => {
    const h = [...document.querySelectorAll('*')].find(
      (e) => e.children.length === 0 && new RegExp('^' + kw, 'i').test(e.textContent || ''),
    );
    return h ? '(section found)' : '(no section)';
  };
  return { checkedRadios: groups };
});
console.log('EEO checked radios:', JSON.stringify(eeo.checkedRadios, null, 0));
// screenshot the EEO area: scroll to Gender
await p
  .getByText('Gender', { exact: false })
  .first()
  .scrollIntoViewIfNeeded()
  .catch(() => {});
await p.waitForTimeout(500);
await p.screenshot({ path: '/tmp/shots/eeo-verify.png', fullPage: true }).catch(() => {});
console.log('full-page screenshot → /tmp/shots/eeo-verify.png');
await p.waitForTimeout(1500);
await ctx.close();
