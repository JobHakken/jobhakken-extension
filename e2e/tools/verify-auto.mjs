/**
 * Autonomous verifier — loads a live form with the extension in Demo mode, fills it, then reports
 * EVERY control's filled/empty state (text, react-select, native select, radio/checkbox groups,
 * Ashby-style Yes/No button pairs, file inputs) as JSON, plus a full-page screenshot. Fill-only,
 * never submits. Exits when done (unlike watch-live, which holds the window open).
 *
 *   VERIFY_URL="https://…" node e2e/tools/verify-auto.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '../../dist');
const URL = process.env.VERIFY_URL;
const PASSES = Number(process.env.PASSES || 4);
if (!URL) {
  console.error('VERIFY_URL required');
  process.exit(1);
}

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
ctx.on('close', () => process.exit(0));
await ctx.addInitScript(() =>
  window.addEventListener(
    'submit',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  ),
);

let sw = ctx.serviceWorkers()[0];
for (let i = 0; i < 20 && !sw; i++) {
  await new Promise((r) => setTimeout(r, 500));
  sw = ctx.serviceWorkers()[0];
}
const id = sw.url().split('/')[2];
const cfg = await ctx.newPage();
await cfg.goto(`chrome-extension://${id}/options/options.html`);
await cfg.evaluate(() => chrome.storage.local.set({ f2a_test_mode: true, f2a_fill_sensitive: true }));
await cfg.close();

const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
const FIELD =
  'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [role=combobox], [role=radio], [class*=yesno]';
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
    let frameId;
    try {
      const key = `f2a_frames:${tab.id}`;
      const counts = (await chrome.storage.session.get(key))[key] ?? {};
      let best = 0;
      for (const [f, c] of Object.entries(counts))
        if (c > best) {
          best = c;
          frameId = Number(f);
        }
    } catch {}
    try {
      await chrome.tabs.sendMessage(
        tab.id,
        { type: 'f2a-rpc', method: 'autofill', params: { mode: 'default' } },
        frameId != null ? { frameId } : {},
      );
    } catch {}
  });
}
for (let i = 0; i < PASSES; i++) {
  await autofill();
  await page.waitForTimeout(1800);
}

const rows = await page.evaluate(() => {
  const labelFor = (el) => {
    const id = el.id;
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l?.textContent?.trim()) return l.textContent.trim();
    }
    const aria = el.getAttribute?.('aria-label');
    if (aria?.trim()) return aria.trim();
    const w = el.closest?.('label');
    if (w?.textContent?.trim()) return w.textContent.trim();
    let n = el.closest?.('fieldset,[class*=field],div,section,li');
    for (let i = 0; n && i < 5; i++, n = n.parentElement) {
      const l = n.querySelector?.('label,legend,h1,h2,h3,h4,[class*=label],[class*=heading]');
      if (l?.textContent?.trim()) return l.textContent.trim();
    }
    return el.name || id || '(?)';
  };
  const seen = new Set();
  const out = [];
  const push = (el, type, value) => {
    if (seen.has(el)) return;
    seen.add(el);
    out.push({
      label: labelFor(el).replace(/\s+/g, ' ').slice(0, 50),
      type,
      value: (value || '').slice(0, 34),
      filled: !!(value || '').trim(),
    });
  };
  // text/textarea (skip react-select internal input)
  document
    .querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]):not([type=radio]):not([type=checkbox]), textarea',
    )
    .forEach((el) => {
      if (el.closest('.select__control')) return;
      push(el, el.tagName === 'TEXTAREA' ? 'textarea' : el.type || 'text', el.value || '');
    });
  document
    .querySelectorAll('.select__control, [class*="select__control"]')
    .forEach((c) =>
      push(c, 'react-select', c.querySelector('.select__single-value, [class*=single-value]')?.textContent ?? ''),
    );
  document.querySelectorAll('select').forEach((el) => {
    const o = el.options[el.selectedIndex];
    push(el, 'native-select', o && o.value ? o.text : '');
  });
  document.querySelectorAll('input[type=file]').forEach((el) => push(el, 'file', el.files?.[0]?.name ?? ''));
  // radio/checkbox groups by name
  const groups = {};
  document.querySelectorAll('input[type=radio],input[type=checkbox]').forEach((el) => {
    const k = el.name || el.id;
    (groups[k] ??= []).push(el);
  });
  for (const g of Object.values(groups)) {
    const checked = g.filter((e) => e.checked);
    push(g[0], g[0].type === 'radio' ? 'radio' : 'checkbox', checked.map((e) => labelFor(e)).join(', '));
  }
  // Ashby yes/no button pairs
  document.querySelectorAll('[class*=yesno]').forEach((grp) => {
    const active = [...grp.querySelectorAll('button')].find((b) => /_active|selected|checked/i.test(b.className));
    push(grp, 'yesno-btn', active?.textContent ?? '');
  });
  return out;
});

const host = URL.replace(/^https?:\/\//, '')
  .split('/')[0]
  .replace(/[^a-z0-9]+/gi, '-');
const shot = path.resolve(process.cwd(), 'test-results', `auto-${host}.png`);
await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
const filled = rows.filter((r) => r.filled).length;
console.log(
  JSON.stringify(
    {
      url: URL,
      screenshot: shot,
      coverage: `${filled}/${rows.length}`,
      pct: Math.round((filled / Math.max(1, rows.length)) * 100),
      empty: rows.filter((r) => !r.filled).map((r) => `${r.type}: ${r.label}`),
      rows,
    },
    null,
    1,
  ),
);
await ctx.close();
