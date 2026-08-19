/* global chrome, document */
/**
 * The WHOLE user flow, exactly as a person does it — fresh install to a filled application.
 * Every step reports PASS/FAIL on its own so a failure is attributable instead of "it doesn't work".
 */
import { chromium } from '@playwright/test';
import path from 'path';
import { rmSync } from 'fs';

const EXT = path.resolve('dist');
const PROFILE_DIR = '/tmp/jh-fullflow';
const RESUME = '/Users/mighty/Documents/github/job/benchmark/jordan-rivera-resume.pdf';
const JOB = 'https://job-boards.greenhouse.io/gitlab/jobs/8503792002';
const KEY = process.env.OR_KEY ?? '';

const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

try {
  rmSync(PROFILE_DIR, { recursive: true, force: true });
} catch {
  /* first run */
}

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
step('1. extension loads (fresh profile)', !!id, `id ${id.slice(0, 12)}…`);

// ── Options: demo mode + AI key ────────────────────────────────────────────
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${id}/options/options.html`);
await opt.waitForTimeout(900);
step(
  '2. options page opens',
  await opt
    .locator('#testMode')
    .count()
    .then((n) => n > 0),
);

await opt.locator('#testMode').evaluate((el) => el.click());
await opt.waitForTimeout(400);
step(
  '3. demo mode toggles ON',
  (await opt.evaluate(async () => (await chrome.storage.local.get('f2a_test_mode')).f2a_test_mode)) === true,
);

await opt.locator('#aiRemember').evaluate((el) => el.click());
await opt.locator('#aiKey').evaluate((el, k) => {
  el.value = k;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, KEY);
await opt.locator('#aiSave').evaluate((el) => el.click());
await opt.waitForTimeout(1500);
const keySaved = await opt.evaluate(async () => ({
  kept: !!(await chrome.storage.local.get('f2a_ai_key_kept')).f2a_ai_key_kept,
  status: document.getElementById('aiStatus')?.textContent?.trim().slice(0, 60),
}));
step('4. AI key saves (+remember)', keySaved.kept, keySaved.status);

// ── Résumé upload → text extraction ───────────────────────────────────────
await opt.locator('#resumePdf').setInputFiles(RESUME);
await opt.waitForTimeout(4000);
const extracted = await opt.locator('#resumeText').inputValue();
step('5. résumé PDF → text extracted', extracted.length > 200, `${extracted.length} chars`);

// ── Parse with AI → profile fields populate ───────────────────────────────
await opt.locator('#resumeParse').evaluate((el) => el.click());
let parsedOk = false;
for (let i = 0; i < 30 && !parsedOk; i++) {
  await opt.waitForTimeout(1000);
  parsedOk = await opt.evaluate(() =>
    [...document.querySelectorAll('.acc[data-p="personal"] input')].some((i) => i.value.trim()),
  );
}
const personal = await opt.evaluate(() =>
  [...document.querySelectorAll('.acc[data-p="personal"] input')]
    .map((i) => i.value)
    .filter(Boolean)
    .slice(0, 6),
);
const parseStatus = await opt.evaluate(() =>
  document.getElementById('resumeStatus')?.textContent?.trim().slice(0, 120),
);
step(
  '6. "Parse with AI" fills the profile',
  parsedOk,
  parsedOk ? personal.join(' · ').slice(0, 90) : `status: "${parseStatus}"`,
);

// ── Save profile → persists ───────────────────────────────────────────────
await opt.locator('#saveProfile').evaluate((el) => el.click());
await opt.waitForTimeout(1200);
const saved = await opt.evaluate(async () => {
  const fp = (await chrome.storage.local.get('f2a_full_profile')).f2a_full_profile;
  return fp ? Object.keys(fp.profile ?? {}).length : 0;
});
step('7. profile saves to storage', saved > 3, `${saved} fields`);

// ── Reopen options → everything still there ───────────────────────────────
await opt.close();
const opt2 = await ctx.newPage();
await opt2.goto(`chrome-extension://${id}/options/options.html`);
await opt2.waitForTimeout(1500);
const persisted = await opt2.evaluate(() => ({
  demo: document.getElementById('testMode')?.checked,
  remember: document.getElementById('aiRemember')?.checked,
  keyActive: document.getElementById('aiClear')?.hidden === false,
  firstField: [...document.querySelectorAll('.acc[data-p="personal"] input')].find((i) => i.value)?.value ?? '',
}));
step(
  '8. settings survive reopening',
  !!persisted.demo && !!persisted.remember && !!persisted.keyActive && !!persisted.firstField,
  JSON.stringify(persisted),
);
await opt2.close();

// ── Live application page → autofill ──────────────────────────────────────
const page = await ctx.newPage();
await page.bringToFront();
await page.goto(JOB, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
const r = await sw.evaluate(async () => {
  const [tb] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tb?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tb.id, { type: 'f2a-rpc', method: 'autofill', params: { mode: 'default' } });
  } catch (e) {
    return { err: String(e).slice(0, 60) };
  }
});
await page.waitForTimeout(2500);
const filled = await page.evaluate(() => {
  const vis = [...document.querySelectorAll('input,textarea,select')].filter(
    (e) =>
      !['hidden', 'submit', 'button', 'file'].includes(e.type) &&
      e.getBoundingClientRect().height > 0 &&
      !/requiredInput/i.test(e.className || ''),
  );
  const val = (e) => {
    const v = String(e.value || '').trim();
    if (v) return v;
    if (e.getAttribute('role') === 'combobox') {
      const b = e.closest('[class*="control"]');
      return ((b && b.textContent) || '').replace(/select\s*\.{2,}/i, '').trim();
    }
    return '';
  };
  return { total: vis.length, filled: vis.filter(val).length };
});
step(
  '9. autofill on a live application',
  filled.filled > 8,
  `${filled.filled}/${filled.total} fields · engine said ${r?.filled}`,
);

await ctx.close();
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} steps passed`);
if (pass < results.length)
  console.log(
    'FAILED:',
    results
      .filter((r) => !r.ok)
      .map((r) => r.name)
      .join(', '),
  );
