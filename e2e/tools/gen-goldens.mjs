/**
 * Generate golden SKELETONS from the captured corpus (#166).
 *
 * The golden files are hand-authored, so they only score the fields a human got around to typing out —
 * 6 of 31 detected fields on Greenhouse, 2 of 16 on Ashby. Roughly 80% of every captured form is
 * therefore unmeasured, and a wrong value in that 80% is invisible to the gate. Hand-writing the
 * missing ~240 expectations is the bottleneck; `detectFields` already knows about every one of them.
 *
 * So this emits the skeleton and leaves the judgement to a person: each newly-discovered field is
 * appended with `review: true` and an empty `expect`. Entries marked `review` are SKIPPED by
 * e2e/goldens.spec.ts — they are a worklist, not an assertion — so running this never moves a number.
 * A reviewer then fills in `expect` (or sets `mustStayEmpty`) and deletes `review`.
 *
 * Two invariants this must never break:
 *   1. MERGE, NEVER OVERWRITE. A human-authored entry is preserved exactly as written.
 *   2. IDEMPOTENT. Running twice in a row produces no diff on the second run.
 *
 * Usage:  npm run gen:goldens
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FIXTURES = path.join(ROOT, 'e2e/fixtures');
const GOLDENS = path.join(ROOT, 'e2e/goldens');
const PKG = path.join(ROOT, 'node_modules/@jobhakken/autofill/build');

/** Load the REAL detector into the page, rather than reimplementing it and drifting from production. */
const MODULES = {
  detect: fs.readFileSync(path.join(PKG, 'detect.js'), 'utf8'),
  signature: fs.readFileSync(path.join(PKG, 'signature.js'), 'utf8'),
  widgets: fs.readFileSync(path.join(PKG, 'widgets.js'), 'utf8'),
};

/** Every captured page in the corpus, relative to e2e/fixtures (matching a golden's `fixture` field). */
function fixtureFiles(dir = FIXTURES, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...fixtureFiles(path.join(dir, e.name), rel));
    else if (e.name.endsWith('.html')) out.push(rel);
  }
  return out;
}

/**
 * A stable way to address this field from Playwright. Prefers a real id, then name; falls back to the
 * label (which `fieldLocator` matches as a case-insensitive regex, and which survives volatile ids).
 * Returns null when the field can't be addressed reliably — better to omit it than to emit a selector
 * that silently matches the wrong element later.
 */
function addressOf(f) {
  const simpleId = /^[A-Za-z][\w-]*$/;
  if (f.id && simpleId.test(f.id)) return { selector: `#${f.id}` };
  if (f.id) return { selector: `[id="${f.id.replace(/"/g, '\\"')}"]` };
  if (f.name) return { selector: `[name="${f.name.replace(/"/g, '\\"')}"]` };
  // Long prose labels make terrible regexes; only use a label that reads like a real field name.
  if (f.label && f.label.length <= 60) return { label: f.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
  // Nothing nameable: fall back to position. Playwright's :nth-match works on a plain locator, and a
  // frozen fixture's DOM order does not move. Without this, a field with no id/name/label can never be
  // named by a golden — so every fill into it reads as an untracked write forever.
  if (f.nth) return { selector: `:nth-match(${f.nth.tag}, ${f.nth.idx})` };
  return null;
}

const keyOf = (e) => e.selector ?? `label:${e.label}`;

const browser = await chromium.launch();
const page = await browser.newPage();

// fixture -> the golden file that already covers it (a golden's filename need not match its fixture).
const existing = new Map();
for (const file of fs.readdirSync(GOLDENS).filter((f) => f.endsWith('.golden.json'))) {
  const g = JSON.parse(fs.readFileSync(path.join(GOLDENS, file), 'utf8'));
  existing.set(g.fixture, { file, golden: g });
}

let added = 0;
const report = [];

for (const rel of fixtureFiles()) {
  await page.goto('file://' + path.join(FIXTURES, rel), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);

  // Identity is the ELEMENT, never the address string. Successive versions of the addressing logic
  // (id, then label, then position) each produced a different string for the same control, so a
  // string-keyed `seen` re-added controls that were already named — hundreds of duplicates, which
  // then double-counted in the scoring. Tag every control once and dedupe on that tag instead.
  await page.evaluate(() =>
    document.querySelectorAll('input, select, textarea').forEach((el, i) => el.setAttribute('data-gg', String(i))),
  );

  const hit = existing.get(rel);
  const golden = hit?.golden ?? {
    fixture: rel,
    _note:
      'Generated skeleton (npm run gen:goldens). Review each `review: true` field: set `expect`, or `mustStayEmpty`, then delete `review`.',
    minRecall: 0,
    fields: [],
  };

  // Which controls are ALREADY named — resolved through the golden's own locators, so whatever form
  // an existing entry's address takes, the element it points at counts as covered.
  const covered = new Set();
  for (const e of golden.fields) {
    const loc = e.label ? page.getByLabel(new RegExp(e.label, 'i')).first() : page.locator(e.selector);
    const ids = await loc.evaluateAll((els) => els.map((x) => x.getAttribute('data-gg'))).catch(() => []);
    for (const id of ids) if (id != null) covered.add(id);
  }

  const detected = await page.evaluate((mods) => {
    const loaded = {};
    const load = (name, code) => {
      const m = { exports: {} };
      new Function('exports', 'require', 'module', code)(
        m.exports,
        (dep) => loaded[dep.replace('./', '').replace('.js', '')],
        m,
      );
      loaded[name] = m.exports;
    };
    load('signature', mods.signature);
    load('widgets', mods.widgets);
    load('detect', mods.detect);
    const nthOf = (el) => {
      const tag = el.tagName.toLowerCase();
      const i = [...document.querySelectorAll(tag)].indexOf(el);
      return i < 0 ? null : { tag, idx: i + 1 };
    };
    const describe = (el, kind) => ({
      gg: el.getAttribute('data-gg'),
      id: el.id ?? '',
      name: el.getAttribute('name') ?? '',
      label: el.getAttribute('aria-label') ?? '',
      kind,
      isFile: el.type === 'file',
      nth: nthOf(el),
    });
    let out = [];
    try {
      out = loaded.detect.detectFields(document).map((f) => ({ ...describe(f.el, f.kind), label: f.label ?? '' }));
    } catch {
      out = [];
    }
    // detectFields is narrower than "things autofill can write to": it skips file inputs (uploads go
    // via detectFileInputs) and the anonymous search <input>s inside custom combobox widgets, yet both
    // get written to. The golden must be able to NAME anything the unexpected-fill check can see, or a
    // legitimate fill there reads as an untracked write forever.
    const have = new Set(out.map((f) => f.gg));
    for (const el of document.querySelectorAll('input, select, textarea')) {
      if (el.disabled || el.type === 'hidden' || have.has(el.getAttribute('data-gg'))) continue;
      out.push(describe(el, el.type === 'file' ? 'file' : el.tagName.toLowerCase()));
    }
    return out;
  }, MODULES);

  if (!hit && detected.length < 4) continue;

  const usedAddr = new Set(golden.fields.map(keyOf));
  const fresh = [];
  for (const f of detected) {
    if (f.gg == null || covered.has(f.gg)) continue; // this control already has an entry
    covered.add(f.gg);
    let addr = addressOf(f);
    if (!addr) continue;
    // Two controls can share a label (BambooHR gives both uploads aria-label="file-input") and a label
    // locator resolves to `.first()`, so the second needs its own, positional address.
    if (usedAddr.has(keyOf(addr)) && f.nth) addr = { selector: `:nth-match(${f.nth.tag}, ${f.nth.idx})` };
    if (usedAddr.has(keyOf(addr))) continue;
    usedAddr.add(keyOf(addr));
    fresh.push({
      ...addr,
      expect: '',
      review: true,
      ...(f.isFile ? { read: 'file' } : {}),
      note: `${f.kind}${f.label ? ` — ${f.label.slice(0, 70)}` : ''}`,
    });
  }

  if (!fresh.length && hit) continue;
  const before = hit ? JSON.parse(JSON.stringify(hit.golden.fields)) : [];
  golden.fields.push(...fresh);
  added += fresh.length;

  for (const [i, prev] of before.entries()) {
    if (JSON.stringify(golden.fields[i]) !== JSON.stringify(prev)) {
      throw new Error(`gen-goldens would have modified an existing entry in ${hit.file}`);
    }
  }
  if (fresh.some((f) => !f.review)) throw new Error(`gen-goldens emitted a non-review entry for ${rel}`);

  const outFile = hit?.file ?? `${rel.replace(/[/\\]/g, '-').replace(/\.html$/, '')}.golden.json`;
  fs.writeFileSync(path.join(GOLDENS, outFile), JSON.stringify(golden, null, 2) + '\n');
  report.push({ fixture: rel, file: outFile, detected: detected.length, added: fresh.length, isNew: !hit });
}

await browser.close();

console.log('\n=== golden skeletons ===');
for (const r of report.sort((a, b) => b.added - a.added)) {
  console.log(
    `${r.isNew ? 'NEW ' : '    '}${r.fixture.padEnd(40)} detected ${String(r.detected).padStart(3)}  +${r.added} to review  (${r.file})`,
  );
}
console.log(`\n${added} field(s) added for review across ${report.length} golden file(s).`);
if (!added) console.log('Nothing new — corpus and goldens are in sync.');
