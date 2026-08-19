/* global document, CSS */
/**
 * Harvest the Greenhouse corpus: every question these forms ask, the control behind it, its options,
 * and the deterministic ids Greenhouse generates.
 *
 * This is the honest version of what a competitor ships as a curated selector config. Those ids are
 * facts about Greenhouse's own DOM — publicly observable by loading the page — so we derive them
 * ourselves rather than copying anyone's compilation. It also stays current, and covers the forms we
 * actually target instead of theirs.
 *
 * Read-only. Loads public postings, records structure, never fills and never submits.
 *
 *   node e2e/live/harvest-greenhouse.mjs [--boards 20] [--per 3] [--out e2e/fixtures/greenhouse-corpus.json]
 */
import { writeFileSync } from 'fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const PER = Number(arg('--per', 3));
const OUT = arg('--out', 'e2e/fixtures/greenhouse-corpus.json');
const TIMEOUT = 20_000;

/** Public Greenhouse boards. Breadth matters more than any one company — the questions repeat. */
const BOARDS = [
  'gitlab',
  'stripe',
  'airbnb',
  'reddit',
  'cloudflare',
  'databricks',
  'discord',
  'figma',
  'sofi',
  'benchling',
  'samsungsemiconductor',
  'anthropic',
  'ramp',
  'plaid',
  'brex',
  'coinbase',
  'robinhood',
  'affirm',
  'instacart',
  'doordash',
  'flexport',
  'gusto',
  'lattice',
  'mixpanel',
  'segment',
  'twilio',
  'asana',
  'dropbox',
  'grammarly',
  'hashicorp',
];

async function boardJobs(board) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.jobs ?? []).map((x) => x.absolute_url).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read one form's structure in the page. Deliberately NOT using our own detection: the corpus should
 * describe what Greenhouse renders, so a detection bug can be seen against it rather than hidden by it.
 */
function readForm() {
  const norm = (s) =>
    (s ?? '')
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[:?.]+$/g, '')
      .trim();
  const labelFor = (el) => {
    const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    return norm(
      byFor?.textContent ||
        el.getAttribute('aria-label') ||
        el.closest('label')?.textContent ||
        el.closest('[class*="field"]')?.querySelector('label')?.textContent ||
        el.getAttribute('placeholder') ||
        el.name ||
        '',
    );
  };
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('input,select,textarea')) {
    const type = el.type;
    if (['hidden', 'submit', 'button', 'search'].includes(type)) continue;
    const r = el.getBoundingClientRect();
    if (r.height === 0 && type !== 'file') continue;
    const label = labelFor(el);
    if (!label || label.length < 2) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // Greenhouse's react-select does NOT put its generated id on the input — the input carries the plain
    // field name (id="country") and the generated id appears in aria-describedby:
    //   aria-describedby="react-select-country-placeholder country-error"
    // Both are deterministic and both are facts about Greenhouse's own DOM, observable by loading the
    // page. `--0` on repeating rows (school--0, degree--0) is what indexes education/experience blocks.
    const described = el.getAttribute('aria-describedby') ?? '';
    const rsId = described.split(/\s+/).find((t) => /^react-select-/.test(t)) ?? null;
    const rowIndex = /--(\d+)/.exec(el.id ?? rsId ?? '')?.[1] ?? null;

    let kind = el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : type || 'text';
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') kind = 'combobox';

    const options =
      el.tagName === 'SELECT'
        ? [...el.options]
            .map((o) => o.textContent.trim())
            .filter(Boolean)
            .slice(0, 60)
        : [];

    out.push({
      label,
      kind,
      required: el.required || /\*/.test(el.closest('[class*="field"]')?.querySelector('label')?.textContent ?? ''),
      name: el.name || null,
      id: el.id || null,
      reactSelectId: rsId,
      rowIndex,
      options,
    });
  }
  return out;
}

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const corpus = { ats: 'greenhouse', generatedAt: null, boards: {}, questions: {} };
let forms = 0;

for (const board of BOARDS) {
  const urls = (await boardJobs(board)).slice(0, PER);
  if (!urls.length) {
    console.log(`  ⚠️  ${board}: no public jobs`);
    continue;
  }
  const page = await browser.newPage();
  const kept = [];
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await page.waitForTimeout(2200);
      const fields = await page.evaluate(readForm);
      if (fields.length < 4) continue;
      kept.push({ url, fields: fields.length });
      forms++;
      for (const f of fields) {
        const k = f.label.toLowerCase().slice(0, 140);
        const q = (corpus.questions[k] ??= {
          label: f.label,
          kinds: {},
          seen: 0,
          boards: [],
          required: 0,
          reactSelectIds: [],
          fieldIds: [],
          options: [],
        });
        q.seen++;
        q.kinds[f.kind] = (q.kinds[f.kind] ?? 0) + 1;
        if (f.required) q.required++;
        if (!q.boards.includes(board)) q.boards.push(board);
        if (f.reactSelectId && !q.reactSelectIds.includes(f.reactSelectId)) q.reactSelectIds.push(f.reactSelectId);
        // The input's own id is the stable field name Greenhouse uses (country, school--0, degree--0).
        if (f.id && !/^\d/.test(f.id) && !q.fieldIds.includes(f.id)) q.fieldIds.push(f.id);
        if (f.options.length && !q.options.length) q.options = f.options;
      }
    } catch {
      /* a posting can close between listing and load */
    }
  }
  await page.close();
  if (kept.length) corpus.boards[board] = kept;
  console.log(
    `  ✓ ${board.padEnd(20)} ${kept.length} form(s), ${Object.keys(corpus.questions).length} distinct questions so far`,
  );
}
await browser.close();

// Rank by how often a question actually appears — that is the build order.
corpus.questions = Object.fromEntries(Object.entries(corpus.questions).sort((a, b) => b[1].seen - a[1].seen));
writeFileSync(OUT, JSON.stringify(corpus, null, 2) + '\n');
console.log(`\n${forms} forms · ${Object.keys(corpus.questions).length} distinct questions → ${OUT}`);
