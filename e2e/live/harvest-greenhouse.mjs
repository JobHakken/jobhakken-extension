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
const CONCURRENCY = Number(arg('--concurrency', 10));
const JITTER_MIN = Number(arg('--jitter-min', 5000));
const JITTER_MAX = Number(arg('--jitter-max', 15000));
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
  // A <label> that WRAPS its control puts the control INSIDE the label element, so `label.textContent`
  // walks through the control's own rendered text too. Three different shapes confirmed on Lever/
  // Workable: <option> text bleeding straight in; a plain <div> SIBLING of the control inside the same
  // label carrying unrelated help text; and a div-based role="combobox" widget (Workable's phone field
  // — the same permanently-mounted intl-tel-input country list that contaminates Greenhouse's own
  // option-scoping) with no <select>/<option> tags at all. Stop at the first thing that looks like a
  // control by tag OR by ARIA role, not just a tag blacklist — plus a length cap as backstop for
  // whatever pattern #4 turns out to be. Greenhouse's own markup hasn't shown this, but it's cheap
  // insurance against the same class of bug.
  const CONTROL_TAGS = new Set(['SELECT', 'OPTION', 'INPUT', 'TEXTAREA', 'BUTTON']);
  const CONTROL_ROLES = new Set(['combobox', 'listbox', 'option', 'radiogroup']);
  const isControlLike = (el) =>
    CONTROL_TAGS.has(el.tagName) ||
    CONTROL_ROLES.has(el.getAttribute('role') ?? '') ||
    el.getAttribute('aria-haspopup') === 'listbox';
  const cleanText = (node) => {
    if (!node) return '';
    let text = '';
    let stopped = false;
    const walk = (n) => {
      for (const child of n.childNodes) {
        if (stopped || text.length > 200) {
          stopped = true;
          return;
        }
        if (child.nodeType === 3) {
          text += child.textContent;
        } else if (child.nodeType === 1) {
          if (isControlLike(child)) {
            stopped = true;
            return;
          }
          walk(child);
        }
      }
    };
    walk(node);
    return text;
  };
  const labelFor = (el) => {
    const l = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    return norm(
      cleanText(l) ||
        el.getAttribute('aria-label') ||
        cleanText(el.closest('label')) ||
        cleanText(el.closest('[class*="field"]')?.querySelector('label')) ||
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

const OPTION_CAP = 300;

/**
 * Read what ONE dropdown offers, and tell the difference between "here is the complete answer" and
 * "here is a sample of a search field."
 *
 * First cut used a global `[class*="option"],[role="option"]` query and it was WRONG: Greenhouse
 * permanently mounts a phone country-code picker whose ~200 items carry role="option" unconditionally.
 * Fixed with a before/after diff, scoped to nothing but what changed because of this click.
 *
 * Second cut treated any dropdown that returned options as a fixed list and tried to scroll it to
 * exhaustion. That was also wrong: "School" is a VIRTUALIZED TYPEAHEAD — the unfiltered view shows an
 * alphabetical default page that keeps growing every scroll (100 -> 344 -> 444..., never verified to
 * terminate), but typing "Zurich" instantly filters to exactly the 2 real matches.
 *
 * Third cut probed "searchable" by typing a NONSENSE query and checking whether the result count
 * shrank. That was WRONG TOO, and wrong in a way that silently broke every field: react-select filters
 * on typed text as a generic UI convenience whether the backing list is 3 fixed items or 10,000
 * virtualized ones — so the nonsense-query probe returned `searchable: true` for literally every
 * combobox in the corpus, including Gender (3 options) and plain Yes/No fields. That test never
 * measured what it claimed to.
 *
 * What actually distinguishes "complete list, typing is just a filter convenience" from "must type to
 * discover anything" is whether the list is DONE GROWING once we stop scrolling: a fixed list (Country,
 * Discipline, Gender) plateaus after one or two scrolls because the whole backing array is short. A
 * virtualized typeahead (School) keeps rendering more items every scroll for as long as we keep going,
 * and a field like "Location (City)" renders literally nothing until you type. So: track the option
 * count after each scroll; if it's still growing at the last one, or started empty, this is a real
 * search field — keep the sample bounded and mark `searchable: true`. If it plateaued, the sample IS
 * the whole list.
 */
async function optionsFor(page, id) {
  try {
    const beforeArr = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="option"],[role="option"]')].map((o) => o.textContent.trim()),
    );
    const before = new Set(beforeArr);
    await page.click(`[id="${id}"]`, { timeout: 2500 });
    await page.waitForTimeout(700);

    const countNew = async () => {
      const raw = await page.evaluate(() =>
        [...document.querySelectorAll('[class*="option"],[role="option"]')]
          .filter((o) => o.getBoundingClientRect().height > 0)
          .map((o) => o.textContent.trim())
          .filter((t) => t && t.length < 90),
      );
      return [...new Set(raw)].filter((t) => !before.has(t));
    };

    const counts = [(await countNew()).length];
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => {
        const opts = [...document.querySelectorAll('[role="option"]')];
        const last = opts[opts.length - 1];
        const menu = last?.closest('[class*="menu" i],[class*="Menu"]') ?? last?.parentElement;
        if (menu) menu.scrollTop = menu.scrollHeight;
      });
      await page.waitForTimeout(250);
      counts.push((await countNew()).length);
    }
    const finalItems = await countNew();
    const sample = finalItems.slice(0, OPTION_CAP);

    const startedEmpty = counts[0] === 0;
    const stillGrowing = counts[counts.length - 1] > counts[counts.length - 2];
    const hitCap = finalItems.length >= OPTION_CAP;
    const searchable = startedEmpty || stillGrowing || hitCap;

    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
    return { options: sample, searchable };
  } catch {
    return { options: [], searchable: false };
  }
}

/**
 * Fetch every board's job listing CONCURRENTLY — these are plain JSON GETs against each company's own
 * boards-api endpoint, with no dependency on each other, so there is no reason to wait for board N
 * before asking about board N+1.
 */
console.log(`  fetching ${BOARDS.length} board listings concurrently…`);
const listings = await Promise.all(
  BOARDS.map(async (board) => ({ board, urls: (await boardJobs(board)).slice(0, PER) })),
);
for (const { board, urls } of listings) if (!urls.length) console.log(`  –  ${board}: no public jobs`);

/** One flat queue of (board, url) work items — this is what makes the worker pool possible. */
const queue = [];
for (const { board, urls } of listings) for (const url of urls) queue.push({ board, url });
queue.length = Math.min(queue.length, MAX);
console.log(`  ${queue.length} postings queued across ${listings.filter((l) => l.urls.length).length} boards\n`);

/**
 * Process the queue with N CONCURRENT tabs instead of one page working through everything in order.
 *
 * The original harvester used three nested sequential `for` loops — boards, then postings, then
 * dropdowns within a posting — with real per-step waits (page settle, click, scroll, type-probe) that
 * do not depend on each other AT ALL across different companies' forms. That serial structure alone
 * was why a run took 20-30+ minutes: killed at 4 of 13 boards after 10 minutes with no sign this was
 * network-bound rather than just not asking for more than one thing at a time. 6 concurrent tabs cut
 * that to roughly 5-6s/form, verified on a 12-form test run.
 *
 * CONCURRENCY is still capped, not unbounded: these postings span many different companies but
 * job-boards.greenhouse.io is shared infrastructure. The RAM to run far more tabs is available, but
 * more tabs alone isn't what makes a crawler look considerate — evenly-timed requests do. Six workers
 * each grabbing their next item the instant they're free produces bursts of up to 6 near-simultaneous
 * new requests, repeating every few seconds. A random JITTER before each worker starts its next item
 * desynchronizes that: workers drift apart over the run instead of staying in lockstep, so raising
 * CONCURRENCY (more parallel work) and adding jitter (less synchronized timing) are complementary, not
 * in tension — one is throughput, the other is request shape.
 */
let cursor = 0;
const boardKept = {};
const jitter = () => JITTER_MIN + Math.random() * (JITTER_MAX - JITTER_MIN);

async function worker() {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1300, height: 950 });
  while (cursor < queue.length && forms < MAX) {
    const item = queue[cursor++];
    if (!item) break;
    const { board, url } = item;
    await page.waitForTimeout(jitter()); // spread this worker's next request out from the others
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: T });
      await page.waitForSelector('input,select,textarea', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(3500);
      const fields = await page.evaluate(readForm);
      if (fields.length < 5) continue;

      for (const f of fields) {
        if (f.kind !== 'combobox' || !f.id || f.options.length) continue;
        const r = await optionsFor(page, f.id);
        f.options = r.options;
        f.searchable = r.searchable;
      }

      forms++;
      (boardKept[board] ??= []).push({
        url,
        fields: fields.length,
        withOptions: fields.filter((f) => f.options.length).length,
      });
      // Object mutation here is safe under concurrency: nothing awaits between the read and the write in
      // this block, and JS only switches tasks at an `await` — so two workers can never interleave mid-update.
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
          searchable: false,
        });
        q.seen++;
        q.kinds[f.kind] = (q.kinds[f.kind] ?? 0) + 1;
        if (f.required) q.required++;
        if (!q.boards.includes(board)) q.boards.push(board);
        if (f.reactSelectId && !q.reactSelectIds.includes(f.reactSelectId)) q.reactSelectIds.push(f.reactSelectId);
        if (f.id && !/^\d/.test(f.id) && !q.fieldIds.includes(f.id)) q.fieldIds.push(f.id);
        if (f.searchable) q.searchable = true;
        if (f.options.length > q.options.length) q.options = f.options.slice(0, OPTION_CAP);
      }
      const withOpts = Object.values(corpus.questions).filter((v) => v.options.length).length;
      console.log(
        `  ✓ ${board.padEnd(20)} ${forms}/${queue.length} forms · ${Object.keys(corpus.questions).length} questions · ${withOpts} with options`,
      );
    } catch {
      /* a posting can close between listing and load */
    }
  }
  await page.close();
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
corpus.boards = boardKept;
await browser.close();

corpus.questions = Object.fromEntries(Object.entries(corpus.questions).sort((a, b) => b[1].seen - a[1].seen));
writeFileSync(OUT, JSON.stringify(corpus, null, 2) + '\n');
const withOpts = Object.values(corpus.questions).filter((v) => v.options.length).length;
console.log(
  `\n${forms} forms · ${Object.keys(corpus.questions).length} questions · ${withOpts} with real option lists → ${OUT}`,
);
