// Workday full-wizard runner: sign in, reach the multi-step application, one-click whole-application
// autofill, report per-step progress + key fields. Never submits. Usage:
//   WD_URL=... WD_EMAIL=... WD_PW=... WD_PROFILE=/tmp/wd/<tenant> node e2e/tools/wd-run.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const URL = process.env.WD_URL,
  EMAIL = process.env.WD_EMAIL,
  PW = process.env.WD_PW;
const PROFILE = process.env.WD_PROFILE || '/tmp/wd/profile';
const HEADED = process.env.PWHEAD === '1';
const args = [
  `--disable-extensions-except=${EXT}`,
  `--load-extension=${EXT}`,
  '--disable-blink-features=AutomationControlled',
];
if (!HEADED) args.unshift('--headless=new');
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  args,
  viewport: { width: 1440, height: 1200 },
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
// Enable Demo mode so the extension fills its built-in dummy TEST_PROFILE (getFullProfile returns
// empty otherwise → nothing fills). A fresh profile has no storage, so this must run every launch.
const extId0 = sw.url().split('/')[2];
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId0}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true })).catch(() => {});
await cfg.close();
const p = await ctx.newPage();
p.on('console', (m) => {
  const t = m.text();
  if (/JH-MS|JH-INT|\[JH/.test(t)) console.log('  [cs]', t.slice(0, 120));
});
const txt = async () => (await p.evaluate(() => document.body.innerText).catch(() => '')) || '';
const step = async () => (await txt()).match(/step\s+\d+\s+of\s+\d+/i)?.[0] || '?';
const bestFrame = async () =>
  sw.evaluate(async () => {
    const s = await chrome.storage.session.get(null);
    let tgt = null;
    for (const [k, c] of Object.entries(s)) {
      if (!k.startsWith('f2a_frames:')) continue;
      const tabId = Number(k.split(':')[1]);
      let b = null;
      for (const [f, n] of Object.entries(c)) {
        if (n > 0 && (!b || n > b.count)) b = { frameId: Number(f), count: n };
      }
      const total = Object.values(c).reduce((a, x) => a + x, 0);
      if (b && (!tgt || total > tgt.total)) tgt = { tabId, frameId: b.frameId, count: b.count, total };
    }
    return tgt;
  });
const has = async (sel) =>
  (await p
    .locator(sel)
    .count()
    .catch(() => 0)) > 0;
const signInIfNeeded = async () => {
  // The account step shows EITHER a Create-Account form (email+password+verifyPassword) or a Sign-In
  // form. If we're on Create Account, switch to Sign In via its link; then fill creds and submit.
  const onAccountStep = (await has('[data-automation-id="email"]')) && (await has('[data-automation-id="password"]'));
  if (!onAccountStep) return;
  const hasSignInLink = await has('[data-automation-id="signInLink"]');
  const hasVerify = await has('[data-automation-id="verifyPassword"]');
  console.log(`  [signIn] account step: signInLink=${hasSignInLink} verifyPassword=${hasVerify}`);
  if (hasSignInLink) {
    await p
      .locator('[data-automation-id="signInLink"]')
      .first()
      .click({ timeout: 6000 })
      .catch((e) => console.log('  [signIn] link click err', e.message.slice(0, 40)));
    await p.waitForTimeout(2000);
    console.log(
      `  [signIn] after link: still has verifyPassword=${await has('[data-automation-id="verifyPassword"]')}`,
    );
  }
  await p
    .locator('input[data-automation-id="email"]')
    .first()
    .fill(EMAIL)
    .catch(() => {});
  await p
    .locator('input[data-automation-id="password"]')
    .first()
    .fill(PW)
    .catch(() => {});
  await p
    .locator('[data-automation-id="signInSubmitButton"]')
    .first()
    .click({ force: true, timeout: 8000 })
    .catch((e) => console.log('  [signIn] submit err', e.message.slice(0, 40)));
  await p.waitForTimeout(7000);
  console.log(
    `  [signIn] after submit → step: ${await step()} | text: ${(await txt()).replace(/\s+/g, ' ').slice(0, 90)}`,
  );
};
console.log('→ goto', URL);
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(3500);
await signInIfNeeded();
// Posting page → click Apply to enter the application flow
if (/\bApply\b/i.test(await txt()) && !/My Information|My Experience/i.test(await txt())) {
  await p
    .getByRole('button', { name: /^Apply$/i })
    .first()
    .click({ timeout: 6000 })
    .catch(() =>
      p
        .getByText(/^Apply$/i)
        .first()
        .click({ timeout: 6000 })
        .catch(() => {}),
    );
  await p.waitForTimeout(3000);
  await signInIfNeeded();
}
// "How would you like to apply?" chooser → Apply Manually
await p
  .getByText(/Apply Manually/i)
  .first()
  .click({ timeout: 4000 })
  .catch(() => {});
await p.waitForTimeout(3000);
await signInIfNeeded();
// Poll until the form frame reports a healthy field count (form fully rendered)
let tgt = null;
for (let i = 0; i < 20; i++) {
  tgt = await bestFrame();
  if (tgt && tgt.total >= 5) break;
  await p.waitForTimeout(1000);
}
console.log('start step:', await step(), '| form frame fields:', JSON.stringify(tgt));
if (!tgt) {
  console.log('NO FORM FRAME — page text:', (await txt()).slice(0, 200));
  await ctx.close();
  process.exit(0);
}
if (process.env.CAPTURE) {
  const { writeFileSync } = await import('fs');
  const html = await p.evaluate(() => document.documentElement.outerHTML);
  writeFileSync(process.env.CAPTURE, html);
  console.log(
    'captured',
    html.length,
    'bytes →',
    process.env.CAPTURE,
    '| has phone code:',
    /country.?phone.?code/i.test(html),
  );
}
if (process.env.PROBE_MS === '1') {
  // Open the Country Phone Code multiselect, type, and dump whatever options render.
  const input = p.locator('[data-automation-id="formField-countryPhoneCode"] input').first();
  console.log('multiselect input count:', await input.count());
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click({ force: true, timeout: 6000 }).catch((e) => console.log('click err', e.message.slice(0, 50)));
  await p.waitForTimeout(700);
  await p.keyboard.type('United States', { delay: 45 }).catch(() => {});
  await p.waitForTimeout(2500);
  const dump = await p.evaluate(() => {
    const bySel = {};
    for (const s of [
      '[data-automation-id="promptOption"]',
      '[role="option"]',
      '[data-automation-id*="rompt"]',
      '[data-automation-id="menuItem"]',
      'li[role="option"]',
      '[data-automation-id*="ption"]',
    ]) {
      const els = [...document.querySelectorAll(s)];
      if (els.length)
        bySel[s] = els.slice(0, 6).map((e) => ({
          aid: e.getAttribute('data-automation-id'),
          lbl: e.getAttribute('data-automation-label'),
          role: e.getAttribute('role'),
          t: (e.textContent || '').trim().slice(0, 40),
        }));
    }
    // also dump the container's live HTML to see the popup shape
    const c = document.querySelector('[data-automation-id="formField-countryPhoneCode"]');
    return { bySel, containerHtml: (c?.outerHTML || '').slice(0, 1600) };
  });
  const { writeFileSync } = await import('fs');
  writeFileSync('/tmp/ms-live.json', JSON.stringify(dump, null, 1));
  console.log('OPTION SELECTORS FOUND:', JSON.stringify(Object.keys(dump.bySel)));
  console.log(JSON.stringify(dump.bySel, null, 1).slice(0, 1200));
  await ctx.close();
  process.exit(0);
}
if (process.env.PROBE_SYN === '1') {
  // Replicate openMultiselect's SYNTHETIC event sequence in-page (what the content script dispatches)
  // and report whether the prompt opens + a click commits — isolates synthetic-vs-real event behavior.
  const res = await p.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const input = document.querySelector('[data-automation-id="formField-countryPhoneCode"] input');
    if (!input) return { err: 'no input' };
    const container = input.closest('[data-automation-id="multiselectInputContainer"]') || input;
    input.focus();
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      const Ev = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
      container.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true }));
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'United States');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 's' }));
    let opts = [];
    for (let i = 0; i < 30; i++) {
      opts = [...document.querySelectorAll('[data-automation-id="promptOption"]')];
      if (opts.length) break;
      await sleep(120);
    }
    const labels = opts.slice(0, 4).map((o) => o.textContent.trim());
    // click the US option
    const us = opts.find((o) => /united states of america/i.test(o.textContent));
    if (us) {
      for (const t of ['mousedown', 'mouseup', 'click']) us.dispatchEvent(new MouseEvent(t, { bubbles: true }));
    }
    await sleep(800);
    const selected = document.querySelector('[data-automation-id="selectedItem"]')?.textContent?.trim() || '';
    return { promptCount: opts.length, sample: labels, clickedUS: !!us, selectedAfter: selected };
  });
  console.log('SYNTHETIC OPEN RESULT:', JSON.stringify(res, null, 1));
  await ctx.close();
  process.exit(0);
}
// Drive the whole-application autofill
const r = await sw.evaluate(
  async (t) =>
    new Promise((res) => {
      chrome.tabs.sendMessage(
        t.tabId,
        { type: 'f2a-rpc', method: 'autofill', params: { mode: 'demo' } },
        { frameId: t.frameId },
        (resp) => res(chrome.runtime.lastError ? { err: chrome.runtime.lastError.message } : resp),
      );
      setTimeout(() => res({ err: 'timeout-180s' }), 180000);
    }),
  tgt,
);
console.log('WIZARD RESULT:', JSON.stringify(r));
await p.waitForTimeout(2500);
console.log('end step:', await step());
const dbg = await p
  .evaluate(() => ({
    fields: localStorage.getItem('jh_dbg_fields'),
    ms: localStorage.getItem('jh_dbg_ms'),
    msPick: localStorage.getItem('jh_dbg_ms_pick'),
    cpcSelected:
      document
        .querySelector('[data-automation-id="formField-countryPhoneCode"] [data-automation-id="selectedItem"]')
        ?.textContent?.trim() || '(empty)',
    reqEmpty: [...document.querySelectorAll('[data-automation-id^="formField-"]')]
      .filter((f) => f.querySelector('abbr[title="required"], abbr'))
      .map((f) => ({
        l: (f.querySelector('label')?.textContent || '').replace('*', '').trim().slice(0, 26),
        filled: !!(
          f.querySelector('input')?.value ||
          f.querySelector('[data-automation-id="selectedItem"]') ||
          /[A-Za-z0-9]/.test(f.querySelector('button')?.textContent?.replace(/select one/i, '') || '')
        ),
      }))
      .filter((x) => !x.filled)
      .map((x) => x.l),
    errors: [...document.querySelectorAll('[data-automation-id="errorMessage"]')]
      .map((e) => e.textContent.trim())
      .slice(0, 8),
  }))
  .catch((e) => ({ err: e.message }));
console.log('DEBUG fields:', dbg.fields);
console.log('DEBUG multiselect:', JSON.stringify({ ms: dbg.ms, pick: dbg.msPick, cpcSelected: dbg.cpcSelected }));
console.log('DEBUG required-still-empty:', JSON.stringify(dbg.reqEmpty), '| errors:', JSON.stringify(dbg.errors));
const dbg2 = await p
  .evaluate(() => ({
    advBtns: [...document.querySelectorAll('button')]
      .filter((b) => /save and continue|continue|next|save/i.test(b.textContent || ''))
      .map((b) => ({
        t: (b.textContent || '').trim().slice(0, 26),
        disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
      })),
    invalid: [...document.querySelectorAll('[aria-invalid="true"]')]
      .map(
        (e) =>
          e.getAttribute('data-automation-id') ||
          e.closest('[data-automation-id^="formField-"]')?.getAttribute('data-automation-id') ||
          e.tagName,
      )
      .slice(0, 10),
    errorish: [...document.querySelectorAll('[class*="error" i],[data-automation-id*="rror"],[role="alert"]')]
      .map((e) => (e.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 6),
  }))
  .catch((e) => ({ err: e.message }));
console.log('DEBUG advance buttons:', JSON.stringify(dbg2.advBtns));
console.log('DEBUG aria-invalid fields:', JSON.stringify(dbg2.invalid), '| errorish:', JSON.stringify(dbg2.errorish));
if (process.env.DUMP === '1') {
  const dump = await p
    .evaluate(() => {
      const out = [];
      const labelOf = (el) => {
        const ll = el.getAttribute('aria-labelledby');
        if (ll) {
          const t = ll
            .split(/\s+/)
            .map((i) => document.getElementById(i)?.textContent || '')
            .join(' ')
            .trim();
          if (t) return t;
        }
        const al = el.getAttribute('aria-label');
        if (al) return al;
        const id = el.id;
        if (id) {
          const l = document.querySelector(`label[for="${id}"]`);
          if (l) return l.textContent.trim();
        }
        return el.getAttribute('data-automation-id') || el.tagName;
      };
      for (const el of document.querySelectorAll(
        'input,select,textarea,button[aria-haspopup="listbox"],[role="combobox"]',
      )) {
        const aid = el.getAttribute('data-automation-id') || '';
        if (/beecatcher|search|menu|signIn|createAccount/i.test(aid)) continue;
        if (el.offsetParent === null && el.getAttribute('aria-haspopup') !== 'listbox') continue;
        const req =
          el.getAttribute('aria-required') === 'true' ||
          !!el.closest('[data-automation-id]')?.querySelector('abbr[title="required"]');
        let val = '';
        if (el.tagName === 'BUTTON' || el.getAttribute('aria-haspopup') === 'listbox')
          val = (el.textContent || '').trim();
        else val = el.value || '';
        out.push({ label: labelOf(el).slice(0, 34), aid: aid.slice(0, 28), req, val: val.slice(0, 30) });
      }
      return out;
    })
    .catch(() => []);
  console.log('=== FIELD DUMP (label | required | value) ===');
  for (const f of dump)
    console.log(`${f.req ? '*' : ' '} ${f.label.padEnd(34)} = ${JSON.stringify(f.val)}  [${f.aid}]`);
}
// Any remaining required-field errors?
const errs = await p
  .evaluate(() =>
    [...document.querySelectorAll('[data-automation-id="errorMessage"],.wd-error,[role="alert"]')]
      .map((e) => e.textContent.trim())
      .filter(Boolean)
      .slice(0, 12),
  )
  .catch(() => []);
if (errs.length) console.log('remaining errors:', JSON.stringify(errs));
await ctx.close();
