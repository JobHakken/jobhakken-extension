import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const URL = process.argv[2];
const applyText = process.argv[3];
const shot = process.argv[4] || '/tmp/shots/ai-fill.png';
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
const rpc = (sw, tgt, method) =>
  sw.evaluate(
    async (a) =>
      new Promise((res) => {
        chrome.tabs.sendMessage(
          a.tabId,
          { type: 'f2a-rpc', method: a.method, params: { mode: 'demo' } },
          { frameId: a.frameId },
          (x) => res(x),
        );
        setTimeout(() => res({ err: 'to' }), 60000);
      }),
    { ...tgt, method },
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
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await p
  .getByRole('button', { name: /accept|agree|got it|allow all/i })
  .first()
  .click({ timeout: 3000 })
  .catch(() => {});
if (applyText) {
  await p
    .getByText(new RegExp(applyText, 'i'))
    .first()
    .click({ timeout: 8000 })
    .catch(() => {});
  await p.waitForTimeout(2500);
}
let tgt = null;
for (let i = 0; i < 20; i++) {
  await p.waitForTimeout(1000);
  tgt = await readTgt(sw);
  if (tgt && tgt.total >= 3) break;
}
console.log('1) regular autofill…');
const a = await rpc(sw, tgt, 'autofill');
console.log('   filled', a?.filled, '/', tgt.total);
// snapshot textareas BEFORE draft
const before = await p.evaluate(() =>
  [...document.querySelectorAll('textarea')].map((t) => ({
    q: (t.closest('div,li')?.querySelector('label,[class*=label]')?.textContent || t.name || '?')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 55),
    len: t.value.length,
  })),
);
console.log('2) draft answers (AI-fill, Demo stub)…');
const d = await rpc(sw, tgt, 'draft');
console.log('   draft result:', JSON.stringify(d));
await p.waitForTimeout(1500);
const after = await p.evaluate(() =>
  [...document.querySelectorAll('textarea')].map((t) => ({
    q: (t.closest('div,li')?.querySelector('label,[class*=label]')?.textContent || t.name || '?')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 55),
    val: t.value.replace(/\s+/g, ' ').slice(0, 90),
    len: t.value.length,
  })),
);
console.log('\n   TEXTAREA QUESTIONS — before → after draft:');
after.forEach((t, i) =>
  console.log(`   • "${t.q}"  [${before[i]?.len || 0}→${t.len} chars]${t.len > 0 ? '\n       → ' + t.val : ''}`),
);
await p.waitForTimeout(500);
await p.screenshot({ path: shot, fullPage: true }).catch(() => {});
await ctx.close();
