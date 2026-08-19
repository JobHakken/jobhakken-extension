/* global document, CSS */
/**
 * Harvest a field corpus from ANY supported ATS — the Greenhouse harvester generalised.
 *
 * Collection is I/O-bound (page loads and dropdown opens), so one ATS at a time wastes wall-clock for
 * no reason. Run several of these concurrently, one per ATS, and the whole corpus lands in the time the
 * slowest one takes.
 *
 * Each ATS publishes a job-board API that its own customers use to embed careers pages; we read those,
 * then load the public application form and record its STRUCTURE — question, control, and the options a
 * dropdown actually offers. Facts about each vendor's own DOM, observable by loading a public posting.
 *
 * Read-only. Never fills, never submits.
 *
 *   node e2e/live/harvest-ats.mjs --ats lever --per 4 --max 40
 */
import { writeFileSync } from 'fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const ATS = arg('--ats', 'greenhouse');
const PER = Number(arg('--per', 4));
const MAX = Number(arg('--max', 40));
const T = 25_000;

const json = async (url, body) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), T);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      method: body ? 'POST' : 'GET',
      headers: body
        ? { accept: 'application/json', 'content-type': 'application/json' }
        : { accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
};

/** Per-ATS: which companies to try, how to list their jobs, and how to reach the APPLICATION form. */
const SOURCES = {
  greenhouse: {
    tokens: [
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
      'warbyparker',
      'peloton',
      'duolingo',
      'axios',
      'deliveroo',
      'monzo',
      'gocardless',
      'wise',
      'depop',
    ],
    list: (t) =>
      json(`https://boards-api.greenhouse.io/v1/boards/${t}/jobs`).then((j) =>
        (j?.jobs ?? []).map((x) => x.absolute_url),
      ),
  },
  lever: {
    tokens: [
      'palantir',
      'netflix',
      'plaid',
      'brex',
      'ramp',
      'anduril',
      'match',
      'atlassian',
      'scaleai',
      'figma',
      'nubank',
      'shopify',
      'spotify',
      'klarna',
      'revolut',
      'n26',
      'bolt',
      'gett',
      'deliveryhero',
      'zalando',
    ],
    list: (t) =>
      json(`https://api.lever.co/v0/postings/${t}?mode=json`).then((j) =>
        (Array.isArray(j) ? j : []).map((x) => x.applyUrl || `${x.hostedUrl}/apply`),
      ),
  },
  ashby: {
    tokens: [
      'ramp',
      'linear',
      'vanta',
      'clay',
      'deel',
      'openai',
      'notion',
      'mercury',
      'replit',
      'posthog',
      'cursor',
      'scale',
      'together',
      'modal',
      'baseten',
      'sourcegraph',
      'runway',
      'sierra',
      'harvey',
      'abridge',
    ],
    list: (t) =>
      json(`https://api.ashbyhq.com/posting-api/job-board/${t}`).then((j) =>
        (j?.jobs ?? []).map((x) => x.applyUrl || `https://jobs.ashbyhq.com/${t}/${x.id}/application`),
      ),
  },
  smartrecruiters: {
    tokens: [
      'Visa',
      'Bosch',
      'Square',
      'McDonalds',
      'Ubisoft',
      'Publicis',
      'LinkedIn',
      'Avery',
      'IKEA',
      'Vodafone',
      'BoschGroup',
      'Sanofi',
      'Airbus',
      'Allianz',
      'Siemens',
    ],
    list: (t) =>
      json(`https://api.smartrecruiters.com/v1/companies/${t}/postings`).then((j) =>
        (j?.content ?? []).map((x) => `https://jobs.smartrecruiters.com/${t}/${x.id}`),
      ),
  },
  workable: {
    tokens: [
      'gorgias',
      'sword-health',
      'remote',
      'deliveroo',
      'omnipresent',
      'flowbird',
      'causaly',
      'persado',
      'blueground',
      'workable',
      'beat',
      'skroutz',
      'e-food',
      'viva-wallet',
    ],
    list: (t) =>
      json(`https://apply.workable.com/api/v1/widget/accounts/${t}?details=true`).then((j) =>
        (j?.jobs ?? []).map((x) => `https://apply.workable.com/${t}/j/${x.shortcode}/apply/`),
      ),
  },
  recruitee: {
    tokens: [
      'tandemdiabetescare',
      'catawiki',
      'usabilla',
      'trengo',
      'sendcloud',
      'framer',
      'mollie',
      'messagebird',
      'backbase',
      'picnic',
      'bynder',
      'channable',
    ],
    list: (t) =>
      json(`https://${t}.recruitee.com/api/offers/`).then((j) =>
        (j?.offers ?? []).map((x) => `https://${t}.recruitee.com/o/${x.slug}/c/new`),
      ),
  },
};

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
  const out = [],
    seen = new Set();
  for (const el of document.querySelectorAll('input,select,textarea')) {
    const type = el.type;
    if (['hidden', 'submit', 'button', 'search'].includes(type)) continue;
    if (el.getBoundingClientRect().height === 0 && type !== 'file') continue;
    const label = labelFor(el);
    if (!label || label.length < 2) continue;
    const k = label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const desc = el.getAttribute('aria-describedby') ?? '';
    let kind = el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : type || 'text';
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') kind = 'combobox';
    out.push({
      label,
      kind,
      required: el.required || /\*/.test(el.closest('[class*="field"]')?.querySelector('label')?.textContent ?? ''),
      id: el.id || null,
      widgetId: desc.split(/\s+/).find((t) => /^react-select-|select/.test(t)) ?? null,
      options: el.tagName === 'SELECT' ? [...el.options].map((o) => o.textContent.trim()).filter(Boolean) : [],
    });
  }
  return out;
}

const src = SOURCES[ATS];
if (!src) {
  console.error(`unknown --ats ${ATS}; known: ${Object.keys(SOURCES).join(', ')}`);
  process.exit(1);
}

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const corpus = { ats: ATS, schema: 2, boards: {}, questions: {} };
let forms = 0,
  openTried = 0,
  openOk = 0;

/**
 * Read what ONE dropdown offers, without trusting any selector to be scoped to it.
 *
 * First cut used a global `[class*="option"],[role="option"]` query, and it was wrong: Greenhouse
 * permanently mounts a phone country-code picker (intl-tel-input) whose ~200 <li> items carry
 * role="option" unconditionally, click or no click. That selector matched all of them regardless of
 * which field was opened, so School/Degree/Discipline came back with "Afghanistan+93, ..." ahead of the
 * real answers — caught by reading the captured VALUES, not by trusting the count.
 *
 * Fixed with a before/after diff: snapshot option-like nodes before the click, again after, keep only
 * what is NEW and currently visible. Universal across ATS DOM conventions — it does not depend on
 * knowing where any given vendor mounts its menu.
 */
async function optionsFor(page, id) {
  openTried++;
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
        .filter((o) => o.getBoundingClientRect().height > 0)
        .map((o) => o.textContent.trim())
        .filter((t) => t && t.length < 90),
    );
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(180);
    const fresh = [...new Set(after)].filter((t) => !before.has(t));
    if (fresh.length) openOk++;
    return fresh.slice(0, 300);
  } catch {
    return [];
  }
}

outer: for (const token of src.tokens) {
  if (forms >= MAX) break;
  const urls = ((await src.list(token)) ?? [])
    .filter((u) => typeof u === 'string' && u.startsWith('http'))
    .slice(0, PER);
  if (!urls.length) {
    console.log(`  –  ${token}: none`);
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
      await page.waitForTimeout(3200);
      // Many ATS put the form behind an Apply button.
      if (
        (await page
          .locator('input,select,textarea')
          .count()
          .catch(() => 0)) < 5
      ) {
        const b = page
          .getByRole('button', { name: /apply|i'?m interested|start application/i })
          .or(page.getByRole('link', { name: /apply/i }))
          .first();
        if (await b.count().catch(() => 0)) {
          await b.click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(3000);
        }
      }
      const fields = await page.evaluate(readForm);
      if (fields.length < 5) continue;
      for (const f of fields) {
        if (f.kind !== 'combobox' || !f.id || f.options.length) continue;
        f.options = await optionsFor(page, f.id);
      }
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
          widgetIds: [],
          fieldIds: [],
          options: [],
        });
        q.seen++;
        q.kinds[f.kind] = (q.kinds[f.kind] ?? 0) + 1;
        if (f.required) q.required++;
        if (!q.boards.includes(token)) q.boards.push(token);
        if (f.widgetId && !q.widgetIds.includes(f.widgetId)) q.widgetIds.push(f.widgetId);
        if (f.id && !/^\d/.test(f.id) && !q.fieldIds.includes(f.id)) q.fieldIds.push(f.id);
        if (f.options.length > q.options.length) q.options = f.options.slice(0, 300);
      }
    } catch {
      /* posting closed or blocked */
    }
  }
  await page.close();
  if (kept.length) corpus.boards[token] = kept;
  console.log(
    `  ✓ ${token.padEnd(20)} ${kept.length} form(s) · ${forms} total · ${Object.keys(corpus.questions).length} questions`,
  );
}
await browser.close();

corpus.questions = Object.fromEntries(Object.entries(corpus.questions).sort((a, b) => b[1].seen - a[1].seen));
corpus.dropdownOpenRate = openTried ? Math.round((openOk / openTried) * 100) : null;
const out = `e2e/fixtures/${ATS}-corpus.json`;
writeFileSync(out, JSON.stringify(corpus, null, 2) + '\n');
const withOpts = Object.values(corpus.questions).filter((v) => v.options.length).length;
console.log(
  `\n[${ATS}] ${forms} forms · ${Object.keys(corpus.questions).length} questions · ${withOpts} with options · dropdown open rate ${corpus.dropdownOpenRate}% → ${out}`,
);
