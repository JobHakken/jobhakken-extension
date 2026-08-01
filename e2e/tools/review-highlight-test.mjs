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
console.log('autofill:', JSON.stringify(r));
await p.waitForTimeout(1500);
// find elements the extension outlined amber (rgb(224,165,63) = #e0a53f)
const outlined = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('*').forEach((el) => {
    const o = el.style?.outline || '';
    if (
      /124,\s*58,\s*237|#7c3aed/i.test(o) ||
      (o.includes('solid') && getComputedStyle(el).outlineColor === 'rgb(124, 58, 237)')
    ) {
      out.push((el.innerText || el.getAttribute('title') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 45));
    }
  });
  return out;
});
console.log('review-outlined fields (' + outlined.length + '):');
outlined.forEach((o) => console.log('   ▸', o));
console.log(
  outlined.length === (r.review ?? -1)
    ? '✓ outlined count == report.review'
    : '⚠ count mismatch (report.review=' + r.review + ')',
);
await p
  .getByText('Gender')
  .first()
  .scrollIntoViewIfNeeded()
  .catch(() => {});
await p.screenshot({ path: '/tmp/shots/review-highlight.png', fullPage: true }).catch(() => {});
await ctx.close();
