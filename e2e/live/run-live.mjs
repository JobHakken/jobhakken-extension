/* global document, chrome, CSS */
/**
 * Real-world autofill baseline: drive OUR extension against currently-live ATS application pages
 * (from gen-targets.mjs) in Demo mode, and report how much of each form we actually fill.
 *
 * FILL ONLY — never clicks submit. Demo mode means the dummy Jordan Rivera profile is used, so no real
 * identity is ever typed into a live form. This is the honest "does it work out there" number that
 * static fixtures can't give us.
 *
 *   node e2e/live/run-live.mjs            (build dist/ first: npm run build)
 *   node e2e/live/run-live.mjs --budget 25000
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium } from '@playwright/test';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(DIR, '../../dist');
const BUDGET = Number(process.argv[process.argv.indexOf('--budget') + 1]) || 30_000;

const { targets } = JSON.parse(readFileSync(path.join(DIR, 'targets.live.json'), 'utf8'));
console.log(`${targets.length} live targets · extension: ${EXT}\n`);

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];

// Demo mode → autofill uses the dummy TEST_PROFILE, never real data.
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${extId}/options/options.html`);
await opt.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true }));
await opt.close();

/** Visible, fillable fields + how many hold a value — measured the way a user would see it. */
const snapshot = (page) =>
  page.evaluate(() => {
    // Count what a PERSON would see and fill. Two corrections that were skewing the number badly:
    //  - react-select renders an invisible `requiredInput` proxy per dropdown purely for HTML5
    //    validation. Those are transparent stand-ins, not fields — counting them inflated the
    //    denominator (4 phantom "fields" on one Greenhouse form).
    //  - file inputs are 1px and hidden behind an "Attach" button; they're handled separately below.
    const vis = [...document.querySelectorAll('input,textarea,select')].filter((e) => {
      if (['hidden', 'submit', 'button', 'file'].includes(e.type)) return false;
      const r = e.getBoundingClientRect();
      if (r.height <= 0 || r.width <= 0) return false;
      // react-select renders TWO inputs per dropdown: the combobox the user interacts with, and a
      // transparent `requiredInput` clone that exists only so HTML5 validation fires. Drop the clone,
      // KEEP the combobox — it's a field the user must still complete, so hiding it would flatter our
      // score while the form stays half-empty.
      if (/requiredInput/i.test(e.className || '')) return false;
      return true;
    });
    const labelFor = (el) => {
      const id = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      return (
        id?.textContent ||
        el.getAttribute('aria-label') ||
        el.closest('label')?.textContent ||
        el.name ||
        el.placeholder ||
        '?'
      )
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 42);
    };
    const val = (e) => {
      if (e.type === 'checkbox' || e.type === 'radio') return e.checked ? 'checked' : '';
      const v = String(e.value || '').trim();
      if (v) return v;
      // A react-select keeps its SEARCH input empty and renders the choice as text inside the control
      // (the submitted value goes to a hidden proxy). Read what the user actually sees — otherwise a
      // successful selection is scored as an empty field.
      if (e.getAttribute('role') === 'combobox') {
        const box = e.closest('[class*="control"], [class*="Control"]');
        const t = ((box && box.textContent) || '').replace(/select\s*\.{2,}/i, '').trim();
        if (t) return t;
      }
      return '';
    };
    const filled = vis.filter((e) => val(e));
    return {
      total: vis.length,
      filled: filled.length,
      // label → value actually placed in the field, so the report shows WHAT went WHERE (dummy data
      // only — Demo mode — so this is safe to keep in the repo/report).
      pairs: filled.map((e) => ({
        field: labelFor(e),
        value: val(e).slice(0, 60),
        kind: e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''),
      })),
      empty: vis.filter((e) => !filled.includes(e)).map(labelFor),
      // Uploads: the input often disappears once the ATS accepts the file (it swaps in a filename
      // chip), so the only reliable evidence is the document naming the file we attached.
      uploads: [...document.querySelectorAll('input[type=file]')].length,
      // An upload counts when EITHER the input still holds the file (Ashby) or the ATS has swapped in
      // a filename chip and removed the input (Greenhouse). Checking only one under-counts the other.
      attached: Math.max(
        (document.body.innerText.match(/jordan-rivera-[a-z-]+\.pdf/gi) || []).length,
        [...document.querySelectorAll('input[type=file]')].filter((f) => (f.files || []).length).length,
      ),
    };
  });

const rows = [];
for (const t of targets) {
  const page = await ctx.newPage();
  const row = { ats: t.ats, url: t.url, title: t.title };
  try {
    await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3500); // SPA render
    const before = await snapshot(page);
    row.fields = before.total;

    const t0 = Date.now();
    const done = await Promise.race([
      sw
        .evaluate(async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.id) return 'no-tab';
          try {
            return await chrome.tabs.sendMessage(tab.id, {
              type: 'f2a-rpc',
              method: 'autofill',
              params: { mode: 'default' },
            });
          } catch (e) {
            return 'err:' + String(e).slice(0, 60);
          }
        })
        .then((r) => ({ r })),
      new Promise((res) => setTimeout(() => res('TIMEOUT'), BUDGET)),
    ]);
    row.ms = Date.now() - t0;
    row.hung = done === 'TIMEOUT';
    await page.waitForTimeout(1500);
    const after = await snapshot(page);
    // A résumé/cover-letter attachment is a completed field from the user's point of view, so count
    // it — the input element itself is gone by then.
    row.attached = after.attached;
    row.fields = before.total + before.uploads;
    row.filled = after.filled - before.filled + after.attached;
    row.rate = row.fields ? Math.round(((after.filled + after.attached) / row.fields) * 100) : 0;
    row.filledFields = after.pairs; // field → value we placed
    row.missed = after.empty; // fields left untouched (the gap list)
  } catch (e) {
    row.error = String(e).split('\n')[0].slice(0, 70);
  }
  rows.push(row);
  const flag = row.hung ? ' ⚠️ HUNG' : '';
  console.log(
    `${(row.ats + '').padEnd(12)} ${String(row.filled ?? '-').padStart(3)}/${String(row.fields ?? '-').padEnd(3)} = ${String(row.rate ?? 0).padStart(3)}%  ${String(row.ms ?? 0).padStart(6)}ms${flag}  ${row.error ?? ''}`,
  );
  await page.close();
}
await ctx.close();

const file = path.join(DIR, 'live-report.json');
writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), rows }, null, 2) + '\n');
const ok = rows.filter((r) => r.rate != null);
const avg = ok.length ? Math.round(ok.reduce((s, r) => s + (r.rate || 0), 0) / ok.length) : 0;
console.log(`\nAVERAGE FILL RATE: ${avg}%   hung: ${rows.filter((r) => r.hung).length}/${rows.length}`);
console.log(`report → ${file}`);
for (const r of rows) if (r.missed?.length) console.log(`\n[${r.ats}] missed: ${r.missed.join(' · ')}`);
