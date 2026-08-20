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
    try {
      return loaded.detect.detectFields(document).map((f) => ({
        id: f.id ?? '',
        name: f.name ?? '',
        label: f.label ?? '',
        kind: f.kind,
        isFile: f.el instanceof HTMLInputElement && f.el.type === 'file',
      }));
    } catch {
      return [];
    }
  }, MODULES);

  const hit = existing.get(rel);
  // A fixture with no golden only earns one if it looks like a real application form; the LinkedIn
  // listing captures and similar pages would otherwise produce empty, meaningless goldens.
  if (!hit && detected.length < 4) continue;

  const golden = hit?.golden ?? {
    fixture: rel,
    _note:
      'Generated skeleton (npm run gen:goldens). Review each `review: true` field: set `expect`, or `mustStayEmpty`, then delete `review`.',
    minRecall: 0,
    fields: [],
  };
  const seen = new Set(golden.fields.map(keyOf));

  const fresh = [];
  for (const f of detected) {
    const addr = addressOf(f);
    if (!addr) continue;
    const key = keyOf(addr);
    if (seen.has(key)) continue; // human-authored (or previously generated) — never touch it
    seen.add(key);
    fresh.push({
      ...addr,
      expect: '',
      review: true,
      ...(f.isFile ? { read: 'file' } : {}),
      note: `${f.kind}${f.label ? ` — ${f.label.slice(0, 70)}` : ''}`,
    });
  }

  if (!fresh.length && hit) continue; // nothing new; leave the file untouched so the run is idempotent
  const before = hit ? JSON.parse(JSON.stringify(hit.golden.fields)) : [];
  golden.fields.push(...fresh);
  added += fresh.length;

  // Enforce invariant 1 on every run rather than trusting it: a human-authored expectation is the
  // whole value of this file, and silently rewriting one would be far worse than not generating at
  // all. Checked here, against the real corpus, so the guarantee can't quietly rot.
  for (const [i, prev] of before.entries()) {
    if (JSON.stringify(golden.fields[i]) !== JSON.stringify(prev)) {
      throw new Error(
        `gen-goldens would have modified an existing entry in ${hit.file}:\n` +
          `  was: ${JSON.stringify(prev)}\n  now: ${JSON.stringify(golden.fields[i])}`,
      );
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
