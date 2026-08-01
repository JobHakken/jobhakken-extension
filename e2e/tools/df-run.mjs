// Dayforce runner: Apply → "Apply without an Account" → reach the application form → one-click
// autofill. No account, no captcha. Never submits. Usage:  DF_URL=<job url> node e2e/tools/df-run.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const URL = process.env.DF_URL;
const PROFILE = process.env.DF_PROFILE || '/tmp/df/run';
const args = [
  `--disable-extensions-except=${EXT}`,
  `--load-extension=${EXT}`,
  '--disable-blink-features=AutomationControlled',
];
if (process.env.PWHEAD !== '1') args.unshift('--headless=new');

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  args,
  viewport: { width: 1400, height: 1150 },
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
const extId = sw.url().split('/')[2];
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true })).catch(() => {});
await cfg.close();

let p = await ctx.newPage();
const txt = async () => (await p.evaluate(() => document.body.innerText).catch(() => '')) || '';
const bestFrame = async () =>
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

console.log('→ goto', URL);
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
await p.waitForTimeout(6000);
await p
  .getByRole('button', { name: /^Accept$/i })
  .first()
  .click({ timeout: 4000 })
  .catch(() => {});
// Apply → opens the apply flow (sometimes a new tab)
const [pop] = await Promise.all([
  ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null),
  p
    .getByText(/^Apply$/)
    .last()
    .click({ timeout: 6000 })
    .catch(() => {}),
]);
if (pop) {
  p = pop;
  await p.waitForTimeout(4000);
}
await p.waitForTimeout(4000);
await p
  .getByRole('button', { name: /^Accept$/i })
  .first()
  .click({ timeout: 3000 })
  .catch(() => {});
// Choose the no-account path
await p
  .getByText(/Apply without an Account/i)
  .first()
  .click({ timeout: 6000 })
  .catch((e) => console.log('no-account click err', e.message.slice(0, 40)));
await p.waitForTimeout(7000);
console.log('after choice:', (await txt()).replace(/\s+/g, ' ').slice(0, 120));

let tgt = null;
for (let i = 0; i < 20; i++) {
  tgt = await bestFrame();
  if (tgt && tgt.total >= 4) break;
  await p.waitForTimeout(1000);
}
console.log('form frame:', JSON.stringify(tgt));
if (!tgt) {
  console.log('NO FORM — page:', (await txt()).replace(/\s+/g, ' ').slice(0, 300));
  await ctx.close();
  process.exit(0);
}
if (process.env.CAPTURE) {
  const { writeFileSync } = await import('fs');
  let ff = p.mainFrame(),
    mx = -1;
  for (const f of p.frames()) {
    const n = await f
      .evaluate(() => document.querySelectorAll('input:not([type=hidden]),select,textarea').length)
      .catch(() => -1);
    if (n > mx) {
      mx = n;
      ff = f;
    }
  }
  writeFileSync(process.env.CAPTURE, await ff.evaluate(() => document.documentElement.outerHTML).catch(() => ''));
  console.log('captured →', process.env.CAPTURE, `(frame fields=${mx})`);
}
const r = await sw.evaluate(
  async (t) =>
    new Promise((res) => {
      chrome.tabs.sendMessage(
        t.tabId,
        { type: 'f2a-rpc', method: 'autofill', params: { mode: 'demo' } },
        { frameId: t.frameId },
        (x) => res(chrome.runtime.lastError ? { err: chrome.runtime.lastError.message } : x),
      );
      setTimeout(() => res({ err: 'timeout' }), 120000);
    }),
  tgt,
);
console.log('AUTOFILL:', JSON.stringify(r));
await p.waitForTimeout(2000);
if (process.env.DUMP === '1') {
  const dump = await p
    .evaluate(() =>
      [...document.querySelectorAll('input,select,textarea')]
        .filter((e) => e.offsetParent && e.type !== 'hidden' && e.type !== 'file')
        .map((e) => ({
          l: (e.labels?.[0]?.textContent || e.getAttribute('aria-label') || e.name || e.placeholder || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 28),
          v: (e.value || '').slice(0, 22),
        }))
        .filter((x) => x.l)
        .slice(0, 30),
    )
    .catch(() => []);
  for (const f of dump) console.log(`   ${f.l.padEnd(30)} = ${JSON.stringify(f.v)}`);
}
await ctx.close();
