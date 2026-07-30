// Oracle Recruiting Cloud (OJET) runner: pass the email-auth gate (cookies → email → terms → Next),
// reach the application form, one-click autofill via the extension, report. Never submits. Usage:
//   OR_URL=<.../apply/email> OR_EMAIL=<temp> node e2e/tools/oracle-run.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const URL = process.env.OR_URL;
const EMAIL = process.env.OR_EMAIL;
const PROFILE = process.env.OR_PROFILE || '/tmp/oracle/run';
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
// Demo mode → extension fills its dummy TEST_PROFILE.
const extId = sw.url().split('/')[2];
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true })).catch(() => {});
await cfg.close();

const p = await ctx.newPage();
const txt = async () => (await p.evaluate(() => document.body.innerText).catch(() => '')) || '';
const bestFrame = async () =>
  sw.evaluate(async () => {
    const s = await chrome.storage.session.get(null);
    let tgt = null;
    for (const [k, c] of Object.entries(s)) {
      if (!k.startsWith('f2a_frames:')) continue;
      const tabId = Number(k.split(':')[1]);
      let b = null;
      for (const [f, n] of Object.entries(c)) if (n > 0 && (!b || n > b.count)) b = { frameId: Number(f), count: n };
      const total = Object.values(c).reduce((a, x) => a + x, 0);
      if (b && (!tgt || total > tgt.total)) tgt = { tabId, frameId: b.frameId, count: b.count, total };
    }
    return tgt;
  });

console.log('→ goto', URL);
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(5000);
await p
  .getByRole('button', { name: /^Accept$/i })
  .click({ timeout: 5000 })
  .catch(() => {}); // cookie banner
await p.waitForTimeout(800);
// Email-auth gate
if (await p.locator('#primary-email-0, input[name="primary-email"]').count()) {
  const emailLoc = p.locator('#primary-email-0, input[name="primary-email"]').first();
  await emailLoc.fill(EMAIL).catch(() => {});
  // Knockout `value` bindings update on the change/blur event, not on input — blur so the email
  // observable is populated before validation, else Next sees it empty and refuses.
  await emailLoc.blur().catch(() => {});
  await emailLoc
    .evaluate((el) => {
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    })
    .catch(() => {});
  await p.waitForTimeout(500);
  // The terms checkbox is a Knockout-bound hidden <input> (data-bind="checked: ...isAccepted"). It
  // updates its observable on the click/change EVENT — a direct `.checked = true` is ignored. A native
  // programmatic input.click() toggles it AND fires the event Knockout needs (works though hidden).
  for (let attempt = 0; attempt < 3; attempt++) {
    const checked = await p
      .evaluate(() => {
        const box = document.querySelector('#legal-disclaimer-checkbox');
        if (box && !box.checked) box.click();
        return document.querySelector('#legal-disclaimer-checkbox')?.checked;
      })
      .catch(() => null);
    if (checked) break;
    await p.waitForTimeout(500);
  }
  await p.waitForTimeout(600);
  await p
    .getByRole('button', { name: /^(Next|Continue|Submit)$/i })
    .first()
    .click({ timeout: 8000, force: true })
    .catch((e) => console.log('gate-next err', e.message.slice(0, 40)));
  await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(6000);
}
const afterGate = (await txt()).replace(/\s+/g, ' ').slice(0, 160);
console.log('after gate:', afterGate);
console.log(
  'code required?',
  /verification code|one-time|enter the code|we sent you|pin|verify your email/i.test(afterGate),
);

// Wait for the application form frame to render
let tgt = null;
for (let i = 0; i < 20; i++) {
  tgt = await bestFrame();
  if (tgt && tgt.total >= 4) break;
  await p.waitForTimeout(1000);
}
console.log('form frame:', JSON.stringify(tgt));
if (!tgt) {
  console.log('NO FORM FRAME — page:', (await txt()).replace(/\s+/g, ' ').slice(0, 200));
  await ctx.close();
  process.exit(0);
}
if (process.env.CAPTURE) {
  const { writeFileSync } = await import('fs');
  writeFileSync(process.env.CAPTURE, await p.evaluate(() => document.documentElement.outerHTML));
  console.log('captured →', process.env.CAPTURE);
}
const r = await sw.evaluate(
  async (t) =>
    new Promise((resolve) => {
      chrome.tabs.sendMessage(
        t.tabId,
        { type: 'f2a-rpc', method: 'autofill', params: { mode: 'demo' } },
        { frameId: t.frameId },
        (rr) => resolve(chrome.runtime.lastError ? { err: chrome.runtime.lastError.message } : rr),
      );
      setTimeout(() => resolve({ err: 'timeout' }), 120000);
    }),
  tgt,
);
console.log('AUTOFILL RESULT:', JSON.stringify(r));
await p.waitForTimeout(2000);
if (process.env.DUMP === '1') {
  const dump = await p.evaluate(() =>
    [...document.querySelectorAll('input,select,textarea')]
      .filter((e) => e.offsetParent !== null && e.type !== 'hidden')
      .map((e) => ({
        l: (e.labels?.[0]?.textContent || e.getAttribute('aria-label') || e.name || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 26),
        v: (e.value || '').slice(0, 24),
      }))
      .slice(0, 40),
  );
  for (const f of dump) console.log(`  ${f.l.padEnd(28)} = ${JSON.stringify(f.v)}`);
}
await ctx.close();
