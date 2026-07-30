// Taleo runner: Apply Online → I Accept → New User → register (username + password + email, no
// captcha / no email verification) → reach the application form → one-click autofill. Never submits.
// Usage:  TL_URL=<jobdetail.ftl url> node e2e/tools/taleo-run.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const URL = process.env.TL_URL;
const STAMP = process.env.TL_STAMP || String(Date.now()).slice(-8);
const USER = `jhqarivera${STAMP}`;
const PW = process.env.TL_PW || 'JhQaTaleo2026xZ';
const EMAIL = process.env.TL_EMAIL || `jordan.rivera.${STAMP}@example.com`;
const PROFILE = process.env.TL_PROFILE || '/tmp/taleo/run';
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

const p = await ctx.newPage();
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
// Taleo labels its fields "User Name. Required" etc. — find an input by a nearby label/aria text.
const fillByLabel = async (re, val) => {
  const ok = await p
    .evaluate(
      ({ reSrc, val }) => {
        const rx = new RegExp(reSrc, 'i');
        const lab = (el) =>
          (
            el.labels?.[0]?.textContent ||
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
            ''
          ).replace(/\s+/g, ' ');
        const el = [...document.querySelectorAll('input')].find((e) => e.offsetParent && rx.test(lab(e)));
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      },
      { reSrc: re, val },
    )
    .catch(() => false);
  return ok;
};

console.log('→ goto', URL);
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
await p.waitForTimeout(5000);
await p
  .getByText(/Apply Online/i)
  .first()
  .click({ timeout: 6000 })
  .catch(() => {});
await p.waitForTimeout(6000);
await p
  .getByRole('button', { name: /I Accept/i })
  .first()
  .click({ timeout: 6000 })
  .catch(() => {});
await p.waitForTimeout(6000);
await p
  .getByRole('button', { name: /New User/i })
  .first()
  .click({ timeout: 6000 })
  .catch(() => {});
await p.waitForTimeout(6000);

// Registration
console.log('registering user', USER);
await fillByLabel('user ?name', USER);
await fillByLabel('re-?enter password|confirm password', PW); // fill confirm first so the base fill below doesn't also hit it
await fillByLabel('^password|(?<!re-enter )password\\.', PW);
await fillByLabel('email', EMAIL);
// robust: fill any still-empty password inputs
await p
  .evaluate((pw) => {
    for (const e of document.querySelectorAll('input[type=password]'))
      if (!e.value) {
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(e, pw);
        e.dispatchEvent(new Event('input', { bubbles: true }));
        e.dispatchEvent(new Event('change', { bubbles: true }));
      }
  }, PW)
  .catch(() => {});
// "Create an account" may be a <button>, <input type=button>, or <a> — click whichever matches.
const created = await p
  .evaluate(() => {
    const rx = /create an account|create account|register|save|continue/i;
    const el = [...document.querySelectorAll('button,input[type=button],input[type=submit],a[role=button],a')].find(
      (e) => e.offsetParent && rx.test((e.textContent || e.value || '').trim()),
    );
    if (el) {
      el.click();
      return (el.textContent || el.value || '').trim().slice(0, 30);
    }
    return null;
  })
  .catch(() => null);
console.log('create-account clicked:', created ?? '(not found)');
await p.waitForTimeout(9000);
const afterReg = (await txt()).replace(/\s+/g, ' ');
console.log('after register:', afterReg.slice(0, 160));
const regErr = await p
  .evaluate(() =>
    [...document.querySelectorAll('.error, [class*="error" i], [role="alert"]')]
      .map((e) => e.textContent.trim())
      .filter(Boolean)
      .slice(0, 4),
  )
  .catch(() => []);
if (regErr.length) console.log('register errors:', JSON.stringify(regErr));

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
// Taleo's first application step is a resume choice — pick "I do not want to upload" + Save & Continue
// to reach the personal-information step where the profile fields live.
if (/upload a resume/i.test(await txt())) {
  await p
    .getByText(/I do not want to upload a resume/i)
    .first()
    .click({ timeout: 5000 })
    .catch(() => {});
  await p
    .evaluate(() => {
      const r = [...document.querySelectorAll('input[type=radio]')].find((e) =>
        /not want to upload/i.test(e.labels?.[0]?.textContent || e.getAttribute('aria-label') || ''),
      );
      if (r) {
        r.checked = true;
        r.click();
      }
    })
    .catch(() => {});
  await p.waitForTimeout(1500);
  await p
    .getByText(/Save and Continue/i)
    .first()
    .click({ timeout: 6000 })
    .catch(() => {});
  await p.waitForTimeout(8000);
  console.log('after resume-step advance:', (await txt()).replace(/\s+/g, ' ').slice(0, 120));
  for (let i = 0; i < 15; i++) {
    const t2 = await bestFrame();
    if (t2 && t2.total >= 4) {
      tgt = t2;
      break;
    }
    await p.waitForTimeout(1000);
  }
  console.log('personal-info frame:', JSON.stringify(tgt));
}
if (process.env.CAPTURE) {
  const { writeFileSync } = await import('fs');
  writeFileSync(process.env.CAPTURE, await p.evaluate(() => document.documentElement.outerHTML).catch(() => ''));
  console.log('captured →', process.env.CAPTURE);
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
          l: (e.labels?.[0]?.textContent || e.getAttribute('aria-label') || e.name || '')
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
