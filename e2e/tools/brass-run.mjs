// BrassRing / Kenexa runner: cookie → Apply → Sign in → Register (username + password + 3 security
// questions) → reach the application form → one-click autofill. Never submits. Usage:
//   BR_URL=<JobDetails url> BR_EMAIL=<temp> node e2e/tools/brass-run.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const URL = process.env.BR_URL;
const EMAIL = process.env.BR_EMAIL;
const PW = process.env.BR_PW || 'JhQaBr2026!x';
const PROFILE = process.env.BR_PROFILE || '/tmp/brass/run';
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

console.log('→ goto', URL);
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
await p.waitForTimeout(7000);
await p
  .getByRole('button', { name: /accept|agree|got it|allow/i })
  .first()
  .click({ timeout: 4000 })
  .catch(() => {});
await p
  .getByText(/apply to job/i)
  .first()
  .click({ timeout: 6000 })
  .catch(() => {});
await p.waitForTimeout(6000);
await p
  .getByText(/^Sign in$/i)
  .first()
  .click({ timeout: 6000 })
  .catch(() => {});
await p.waitForTimeout(6000);
await p
  .getByText(/Don'?t have an account|create an account|register|new user/i)
  .first()
  .click({ timeout: 6000 })
  .catch(() => {});
await p.waitForTimeout(6000);

// Registration form
if (await p.locator('#username').count()) {
  await p
    .locator('#username')
    .fill(EMAIL)
    .catch(() => {});
  await p
    .locator('#password')
    .fill(PW)
    .catch(() => {});
  await p
    .locator('#confirmPassword')
    .fill(PW)
    .catch(() => {});
  // Security questions are jQuery UI selectmenus (#selectSecurityQuestionN-button opens a menu).
  // Pick a DISTINCT question in each, and give each a UNIQUE answer ("must be unique").
  const answers = ['Rivera', 'Austin', 'Globex'];
  const usedQ = [];
  for (let i = 1; i <= 3; i++) {
    await p
      .locator(`#selectSecurityQuestion${i}-button`)
      .click({ timeout: 5000 })
      .catch(() => {});
    await p.waitForTimeout(700);
    const opts = p.locator(`#selectSecurityQuestion${i}-menu li`);
    const n = await opts.count().catch(() => 0);
    // Pick the first option whose text is a real question AND not already used elsewhere.
    let clicked = false;
    for (let j = 0; j < n; j++) {
      const t =
        (
          await opts
            .nth(j)
            .textContent()
            .catch(() => '')
        )
          ?.replace(/\s+/g, ' ')
          .trim() || '';
      if (!t || /select question/i.test(t) || usedQ.includes(t)) continue;
      await opts
        .nth(j)
        .click({ timeout: 4000 })
        .catch(() => {});
      usedQ.push(t);
      clicked = true;
      break;
    }
    if (!clicked) console.log(`  [brass] Q${i} no distinct option found (n=${n})`);
    await p.waitForTimeout(400);
    await p
      .locator(`#securityQuestion${i}Answer`)
      .fill(answers[i - 1])
      .catch(() => {});
  }
  console.log('  [brass] questions:', JSON.stringify(usedQ));
  await p
    .locator('#createAccountForm_BUTTON_0, button:has-text("Continue")')
    .first()
    .click({ timeout: 8000, force: true })
    .catch((e) => console.log('reg-continue err', e.message.slice(0, 40)));
  await p.waitForTimeout(9000);
  // Capture any validation error on the register form
  const regErr = await p
    .evaluate(() =>
      [...document.querySelectorAll('[class*="error" i],[role="alert"],.field-error,.validation')]
        .map((e) => (e.textContent || '').trim())
        .filter(Boolean)
        .slice(0, 4),
    )
    .catch(() => []);
  if (regErr.length) console.log('register validation:', JSON.stringify(regErr));
}
const afterReg = (await txt()).replace(/\s+/g, ' ').slice(0, 200);
console.log('after register:', afterReg);
console.log(
  'email verification needed?',
  /verify|verification|confirm your email|code we sent|check your (in)?box/i.test(afterReg),
);
// Some BrassRing flows bounce to a sign-in after account creation — sign in with the new creds.
if (await p.locator('#loginField').count()) {
  console.log('bounced to sign-in — signing in with new account');
  await p
    .locator('#loginField')
    .fill(EMAIL)
    .catch(() => {});
  await p
    .locator('#password')
    .fill(PW)
    .catch(() => {});
  await p
    .locator('#btnLogin, button:has-text("Sign in")')
    .first()
    .click({ timeout: 8000, force: true })
    .catch(() => {});
  await p.waitForTimeout(9000);
}

// Application start page → enter the form
await p
  .getByRole('button', { name: /let'?s get started|start your application|begin/i })
  .first()
  .click({ timeout: 6000 })
  .catch(() =>
    p
      .getByText(/let'?s get started/i)
      .first()
      .click({ timeout: 6000 })
      .catch(() => {}),
  );
await p.waitForTimeout(7000);
// Reach the application form
let tgt = null;
for (let i = 0; i < 20; i++) {
  tgt = await bestFrame();
  if (tgt && tgt.total >= 4) break;
  await p.waitForTimeout(1000);
}
// Fallback: BrassRing's Angular form is in the top frame but its fields sit in a collapsed accordion,
// so the content script may report 0 to frameStore. Expand sections + force-fill the top frame.
if (!tgt) {
  await p
    .evaluate(() => {
      for (const h of document.querySelectorAll(
        '[aria-expanded="false"], .collapsed, [class*="accordion" i] [role="button"], button[class*="section" i]',
      )) {
        try {
          h.click();
        } catch {
          /* expand */
        }
      }
    })
    .catch(() => {});
  await p.waitForTimeout(2500);
  tgt = (await bestFrame()) || {
    tabId: await sw.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id),
    frameId: 0,
    total: 0,
  };
  console.log('fallback target:', JSON.stringify(tgt));
}
console.log('form frame:', JSON.stringify(tgt));
if (false) {
  console.log('NO FORM — page:', (await txt()).replace(/\s+/g, ' ').slice(0, 500));
  const controls = await p
    .evaluate(() =>
      [...document.querySelectorAll('a,button,input[type="submit"]')]
        .filter((e) => e.offsetParent)
        .map((e) => (e.textContent || e.value || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && t.length < 40)
        .slice(0, 20),
    )
    .catch(() => []);
  console.log('next-step controls:', JSON.stringify(controls));
  // Frame diagnostics: where are the form fields (iframe? which domain?)
  for (const f of p.frames()) {
    const cnt = await f
      .evaluate(() => document.querySelectorAll('input:not([type=hidden]),select,textarea').length)
      .catch(() => -1);
    if (cnt > 0) console.log(`  frame fields=${cnt} :: ${f.url().slice(0, 80)}`);
  }
  const { writeFileSync } = await import('fs');
  writeFileSync('/tmp/brass-form.html', await p.evaluate(() => document.documentElement.outerHTML).catch(() => ''));
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
  const dump = await p.evaluate(() =>
    [...document.querySelectorAll('input,select,textarea')]
      .filter((e) => e.offsetParent && e.type !== 'hidden' && e.type !== 'file')
      .map((e) => ({
        l: (e.labels?.[0]?.textContent || e.getAttribute('aria-label') || e.name || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 26),
        v: (e.value || '').slice(0, 22),
      }))
      .filter((x) => x.l)
      .slice(0, 30),
  );
  for (const f of dump) console.log(`   ${f.l.padEnd(28)} = ${JSON.stringify(f.v)}`);
}
await ctx.close();
