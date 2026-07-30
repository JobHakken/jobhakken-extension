/**
 * "Fire it up and watch" tool — launches a REAL, visible Chromium with the extension,
 * fills a live form, prints a filled/empty breakdown, and then LEAVES THE WINDOW OPEN so
 * you can scroll and inspect what landed vs what's still blank. Fill-only; never submits.
 *
 *   VERIFY_URL="https://…" node e2e/tools/watch-live.mjs        # defaults to the Two Six form
 *   PASSES=6 VERIFY_URL="…"  node e2e/tools/watch-live.mjs        # more autofill passes
 *
 * Close the browser window (or Ctrl+C the terminal) when you're done.
 */
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '../../dist');
const URL = process.env.VERIFY_URL || 'https://job-boards.greenhouse.io/twosixtechnologies/jobs/6123756004';
const PASSES = Number(process.env.PASSES || 4);

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  slowMo: 120,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--start-maximized'],
});
// closing the window ends the process cleanly
ctx.on('close', () => process.exit(0));

// safety net: fill-only, never submit — swallow any form submission
await ctx.addInitScript(() => {
  window.addEventListener(
    'submit',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const extId = sw.url().split('/')[2];

const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${extId}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true, f2a_fill_sensitive: true }));
await cfg.close();

const page = await ctx.newPage();
await page.bringToFront();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
const FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
await page.waitForSelector(FIELD, { timeout: 20000 }).catch(() => {});
if (
  (await page
    .locator(FIELD)
    .count()
    .catch(() => 0)) < 3
) {
  const apply = page
    .getByRole('button', { name: /apply|i'?m interested|start application/i })
    .or(page.getByRole('link', { name: /apply/i }))
    .first();
  if (await apply.count().catch(() => 0)) {
    await apply.click({ timeout: 5000 }).catch(() => {});
    await page.waitForSelector(FIELD, { timeout: 15000 }).catch(() => {});
  }
}

async function autofill() {
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'f2a-rpc', method: 'autofill', params: { mode: 'default' } });
    } catch {
      /* content script not ready — next pass retries */
    }
  });
}
console.log(`\nFilling ${URL} (${PASSES} passes)…`);
for (let i = 0; i < PASSES; i++) {
  await autofill();
  await page.waitForTimeout(2000);
}

const rows = await page.evaluate(() => {
  const labelFor = (el) => {
    const id = el.id;
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l?.textContent?.trim()) return l.textContent.trim();
    }
    const aria = el.getAttribute('aria-label');
    if (aria?.trim()) return aria.trim();
    const wrap = el.closest('label');
    if (wrap?.textContent?.trim()) return wrap.textContent.trim();
    let n = el.closest('div,section,li,fieldset');
    for (let i = 0; n && i < 4; i++, n = n.parentElement) {
      const l = n.querySelector('label,h1,h2,h3,h4,legend');
      if (l?.textContent?.trim()) return l.textContent.trim();
    }
    return el.name || id || '(?)';
  };
  const out = [];
  const push = (el, type, value) =>
    out.push({
      label: labelFor(el).replace(/\s+/g, ' ').slice(0, 46),
      type,
      value: (value || '').slice(0, 34),
      filled: !!(value || '').trim(),
    });
  document
    .querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]):not([type=radio]):not([type=checkbox]), textarea',
    )
    .forEach((el) => {
      if (el.closest('.select__control')) return;
      push(el, el.tagName === 'TEXTAREA' ? 'textarea' : el.type || 'text', el.value || '');
    });
  document.querySelectorAll('.select__control, [class*="select__control"]').forEach((ctrl) => {
    const sv = ctrl.querySelector('.select__single-value, [class*="single-value"]');
    push(ctrl, 'react-select', sv?.textContent ?? '');
  });
  document.querySelectorAll('select').forEach((el) => {
    const opt = el.options[el.selectedIndex];
    push(el, 'native-select', opt && opt.value ? opt.text : '');
  });
  document.querySelectorAll('input[type="file"]').forEach((el) => push(el, 'file', el.files?.[0]?.name ?? ''));
  return out;
});

const fillable = rows.filter((r) => r.type !== 'choice');
const filled = fillable.filter((r) => r.filled).length;
console.table(rows.map((r) => ({ field: r.label, type: r.type, filled: r.filled ? '✓' : '—', value: r.value })));
console.log(
  `\nFULL-FORM COVERAGE: ${filled}/${fillable.length} (${Math.round((filled / Math.max(1, fillable.length)) * 100)}%)`,
);
console.log(
  '\n>>> Window LEFT OPEN — scroll through the form to inspect. Close the window (or Ctrl+C) when done. <<<\n',
);

await new Promise(() => {}); // hold open until the user closes the window
