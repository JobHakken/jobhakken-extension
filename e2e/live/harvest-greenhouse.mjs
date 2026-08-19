/* global document, CSS */
/**
 * Harvest a HIGH-QUALITY Greenhouse corpus: real questions, the control behind each, and — the
 * expensive part — the actual option list for every dropdown, read by opening it.
 *
 * Why the options matter: react-select renders nothing until it opens, so a cheap pass records the
 * question and control but not what the field will ACCEPT. Without that there is no shape check, and
 * "is our value one of these?" is the rule that prevents putting "6" in a yes/no field.
 *
 * These ids and options are facts about Greenhouse's own DOM, observable by loading a public posting.
 * We read them ourselves rather than copying anyone's compilation.
 *
 * Read-only: loads public postings, records structure, never fills and never submits.
 *
 *   node e2e/live/harvest-greenhouse.mjs [--per 4] [--max 45] [--out e2e/fixtures/greenhouse-corpus.json]
 */
import { writeFileSync } from 'fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const PER = Number(arg('--per', 4));
const MAX = Number(arg('--max', 45));
const OUT = arg('--out', 'e2e/fixtures/greenhouse-corpus.json');
const T = 25_000;

/** Deliberately mixed: tech, fintech, health, retail, media, non-US — not just companies I recall. */
const BOARDS = [
  'gitlab',
  'reddit',
  'cloudflare',
  'discord',
  'figma',
  'anthropic',
  'robinhood',
  'affirm',
  'flexport',
  'gusto',
  'mixpanel',
  'twilio',
  'samsungsemiconductor',
  'sofi',
  'benchling',
  'oscarhealth',
  'devoted',
  'included',
  'cedar',
  'komodohealth',
  'warbyparker',
  'allbirds',
  'peloton',
  'sweetgreen',
  'faire',
  'vox',
  'theathletic',
  'axios',
  'duolingo',
  'chess',
  'deliveroo',
  'monzo',
  'gocardless',
  'wise',
  'checkout',
  'thoughtmachine',
  'improbable',
  'babylonhealth',
  'trainline',
  'depop',
];

async function boardJobs(board) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), T);
  try {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`, {
      signal: c.signal,
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return [];
    return ((await r.json()).jobs ?? []).map((x) => x.absolute_url).filter(Boolean);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** Structure only. Deliberately not our own detector — the corpus must be able to expose OUR bugs. */
function readForm() {
  const norm = (s) =>
    (s ?? '')
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[:?.]+$/g, '')
      .trim();
  const labelFor = (el) => {
    const l = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    return norm(
      l?.textContent ||
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
    if (el.getBoundingClientRect().height === 0 && type !== 'file') continue;
    const label = labelFor(el);
    if (!label || label.length < 2) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const described = el.getAttribute('aria-describedby') ?? '';
    let kind = el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : type || 'text';
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') kind = 'combobox';
    out.push({
      label,
      kind,
      required: el.required || /\*/.test(el.closest('[class*="field"]')?.querySelector('label')?.textContent ?? ''),
      id: el.id || null,
      reactSelectId: described.split(/\s+/).find((t) => /^react-select-/.test(t)) ?? null,
      options: el.tagName === 'SELECT' ? [...el.options].map((o) => o.textContent.trim()).filter(Boolean) : [],
    });
  }
  return out;
}

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const corpus = { ats: 'greenhouse', schema: 2, boards: {}, questions: {} };
let forms = 0;

/** Open one combobox and read what it offers. This is the slow part, and the reason the corpus is useful. */
/**
 * Read what ONE dropdown offers, without trusting any selector to be scoped to it.
 *
 * First cut used a global `[class*="option"],[role="option"]` query and it was WRONG: Greenhouse
 * permanently mounts a phone country-code picker (intl-tel-input) whose ~200 `<li>` items carry
 * role="option" unconditionally, hidden or not, click or no click. That selector matched all of them
 * regardless of which field was actually opened, so School/Degree/Discipline came back with
 * "Afghanistan+93, Åland Islands+358, ..." ahead of the real answers -- caught by reading the captured
 * VALUES, not by trusting the count.
 *
 * Fixed with a before/after diff: snapshot every option-like node before the click, snapshot again
 * after, keep only what is NEW. That is universal across ATS DOM conventions -- it does not depend on
 * knowing where any given vendor mounts its menu -- and it is immune to anything that was already
 * sitting in the DOM before we touched this field.
 */
async function optionsFor(page, id) {
  try {
    // page.evaluate() does not reliably round-trip a Set through Playwright's serialization boundary —
    // it comes back unusable in Node. Return a plain array and build the Set on this side.
    const beforeArr = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="option"],[role="option"]')].map((o) => o.textContent.trim()),
    );
    const before = new Set(beforeArr);
    await page.click(`[id="${id}"]`, { timeout: 2500 });
    await page.waitForTimeout(700);
    const after = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="option"],[role="option"]')]
        .filter((o) => o.getBoundingClientRect().height > 0) // visible now, not just present
        .map((o) => o.textContent.trim())
        .filter((t) => t && t.length < 90),
    );
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
    const fresh = [...new Set(after)].filter((t) => !before.has(t));
    return fresh.slice(0, 300);
  } catch {
    return [];
  }
}

outer: for (const board of BOARDS) {
  if (forms >= MAX) break;
  const urls = (await boardJobs(board)).slice(0, PER);
  if (!urls.length) {
    console.log(`  –  ${board}: no public jobs`);
    continue;
  }
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1300, height: 950 });
  const kept = [];
  for (const url of urls) {
    if (forms >= MAX) {
      await page.close();
      break outer;
    }
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: T });
      await page.waitForSelector('input,select,textarea', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(3500); // real settle time, not a guess at 2.2s
      const fields = await page.evaluate(readForm);
      if (fields.length < 5) continue;

      // Open each dropdown and record what it accepts.
      for (const f of fields) {
        if (f.kind !== 'combobox' || !f.id || f.options.length) continue;
        f.options = await optionsFor(page, f.id);
      }

      kept.push({ url, fields: fields.length, withOptions: fields.filter((f) => f.options.length).length });
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
          optionCounts: [],
        });
        q.seen++;
        q.kinds[f.kind] = (q.kinds[f.kind] ?? 0) + 1;
        if (f.required) q.required++;
        if (!q.boards.includes(board)) q.boards.push(board);
        if (f.reactSelectId && !q.reactSelectIds.includes(f.reactSelectId)) q.reactSelectIds.push(f.reactSelectId);
        if (f.id && !/^\d/.test(f.id) && !q.fieldIds.includes(f.id)) q.fieldIds.push(f.id);
        if (f.options.length) {
          q.optionCounts.push(f.options.length);
          // keep the LONGEST list seen — a truncated open would otherwise poison the record
          if (f.options.length > q.options.length) q.options = f.options.slice(0, 300);
        }
      }
    } catch {
      /* a posting can close between listing and load */
    }
  }
  await page.close();
  if (kept.length) corpus.boards[board] = kept;
  const withOpts = Object.values(corpus.questions).filter((v) => v.options.length).length;
  console.log(
    `  ✓ ${board.padEnd(20)} ${kept.length} form(s) · ${forms} total · ${Object.keys(corpus.questions).length} questions · ${withOpts} with options`,
  );
}
await browser.close();

corpus.questions = Object.fromEntries(Object.entries(corpus.questions).sort((a, b) => b[1].seen - a[1].seen));
writeFileSync(OUT, JSON.stringify(corpus, null, 2) + '\n');
const withOpts = Object.values(corpus.questions).filter((v) => v.options.length).length;
console.log(
  `\n${forms} forms · ${Object.keys(corpus.questions).length} questions · ${withOpts} with real option lists → ${OUT}`,
);
