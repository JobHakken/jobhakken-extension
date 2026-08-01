import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');
const URL = process.argv[2];
const applyText = process.argv[3];
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
const PROBE = () => {
  document.querySelectorAll('form').forEach((f) =>
    f.addEventListener(
      'submit',
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    ),
  );
  try {
    HTMLFormElement.prototype.submit = function () {};
    HTMLFormElement.prototype.requestSubmit = function () {};
  } catch {}
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const lbl = (el) => {
    if (el.getAttribute && el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    const id = el.id;
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l) return l.innerText.trim();
    }
    const w = el.closest && el.closest('label');
    if (w) return w.innerText.trim();
    let n = el.closest && el.closest('div,li,fieldset,section');
    for (let i = 0; i < 4 && n; i++) {
      const t = (n.querySelector('label,legend,.text,[class*=label],h3,h4')?.textContent || '').trim();
      if (t && t.length < 120) return t;
      n = n.parentElement;
    }
    return el.name || el.placeholder || '?';
  };
  // combobox-aware emptiness: react-select/aria comboboxes keep the raw <input> empty and show the
  // chosen value in a single-value/chip node — so check the widget's displayed selection.
  const comboFilled = (el) => {
    const c = el.closest('[class*=select__],[class*=Select],[class*=combobox],[role=combobox],[class*=dropdown]');
    if (!c) return null;
    const sv = c.querySelector(
      '[class*=singleValue],[class*=single-value],[class*=multiValue],[class*=multi-value],[class*=__value],[class*=selected]',
    );
    if (sv && txt(sv)) return true;
    // aria: the combobox's own text minus placeholder
    const ph = el.getAttribute('placeholder') || '';
    const t = txt(c).replace(ph, '').trim();
    return t.length > 1;
  };
  const isEmpty = (el) => {
    if (el.type === 'checkbox' || el.type === 'radio') {
      const g = el.name ? [...document.getElementsByName(el.name)] : [el];
      return !g.some((x) => x.checked);
    }
    if (el.tagName === 'SELECT') return el.selectedIndex <= 0 || el.value === '';
    const cf = comboFilled(el);
    if (cf !== null) return !cf;
    return !el.value;
  };
  document.querySelectorAll('button[type=submit],input[type=submit],button:not([type])').forEach((b) => {
    try {
      b.click();
    } catch {}
  });
  const flagged = [];
  document.querySelectorAll('input,select,textarea').forEach((el) => {
    const t = (el.type || el.tagName).toLowerCase();
    if (['hidden', 'file', 'button', 'submit'].includes(t)) return;
    const req = el.required || el.getAttribute('aria-required') === 'true';
    const invalid = (el.matches && el.matches(':invalid')) || el.getAttribute('aria-invalid') === 'true';
    const empty = isEmpty(el);
    if ((req && empty) || (invalid && empty))
      flagged.push({ label: lbl(el).replace(/\s+/g, ' ').slice(0, 60), type: t, reason: 'required-empty' });
  });
  const seen = new Set();
  const uniq = flagged.filter((f) => {
    const k = f.label + f.type;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const errs = [
    ...new Set(
      [...document.querySelectorAll('[role=alert],[class*=error]:not(input):not(select),.field-error')]
        .filter((e) => e.offsetParent !== null && txt(e).length > 2 && txt(e).length < 100)
        .map(txt),
    ),
  ].slice(0, 15);
  return { flagged: uniq, errs };
};
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
p.on('dialog', (d) => d.dismiss().catch(() => {}));
await clearFrames(sw);
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 }); // NO route yet — let the SPA load
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
if (!tgt) {
  console.log('NO FORM');
  await ctx.close();
  process.exit(0);
}
await sw.evaluate(
  async (t) =>
    new Promise((res) => {
      chrome.tabs.sendMessage(
        t.tabId,
        { type: 'f2a-rpc', method: 'autofill', params: { mode: 'demo' } },
        { frameId: t.frameId },
        res,
      );
      setTimeout(res, 60000);
    }),
  tgt,
);
await p.waitForTimeout(2500);
// NOW block submission (form loaded + filled): abort any non-GET so nothing can leave, then probe
await p.route('**/*', (r) => {
  if (r.request().method() !== 'GET') return r.abort();
  return r.continue();
});
let flagged = [],
  errs = [];
for (const fr of p.frames()) {
  try {
    const r = await fr.evaluate(PROBE);
    flagged = flagged.concat(r.flagged);
    errs = errs.concat(r.errs);
  } catch {}
}
const seen = new Set();
flagged = flagged.filter((f) => {
  const k = f.label + f.type;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
console.log(`\n=== ${flagged.length} STILL REQUIRED-EMPTY AFTER AUTOFILL ===`);
for (const f of flagged) console.log(`   ✗ [${f.type}] ${f.label}`);
if (errs.length) {
  console.log('--- form error messages ---');
  [...new Set(errs)].forEach((e) => console.log('   • ' + e));
}
await ctx.close();
