/* global document */
/**
 * Generate CURRENTLY-ACTIVE ATS application URLs from public job-board APIs.
 *
 * The old hand-written targets.json held placeholder templates (`<company>/<job-id>`) that were never
 * real, so the live canary could never actually run. Job URLs also rot within weeks, which is why a
 * committed list is the wrong shape. Instead we ask each ATS's PUBLIC board API (the same endpoints
 * companies use to embed their careers page) for jobs that are open right now, and build the apply URL
 * from the documented pattern.
 *
 * Read-only: this fetches public listings. Nothing is submitted anywhere.
 *
 *   node e2e/live/gen-targets.mjs            → writes e2e/live/targets.live.json
 *   node e2e/live/gen-targets.mjs --per 2    → 2 jobs per ATS family
 */
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PER = Number(process.argv[process.argv.indexOf('--per') + 1]) || 2;
const TIMEOUT = 15_000;

/** Candidate company tokens per ATS. Several are tried because any one company may pause hiring. */
const SOURCES = [
  {
    ats: 'greenhouse',
    tokens: ['gitlab', 'databricks', 'discord', 'benchling', 'figma'],
    api: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
    pick: (j) => (j.jobs ?? []).map((x) => ({ url: x.absolute_url, title: x.title })),
  },
  {
    ats: 'ashby',
    tokens: ['ramp', 'linear', 'vanta', 'clay', 'deel'],
    api: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
    pick: (j, t) =>
      (j.jobs ?? []).map((x) => ({
        url: x.applyUrl || `https://jobs.ashbyhq.com/${t}/${x.id}/application`,
        title: x.title,
      })),
  },
  {
    ats: 'lever',
    tokens: ['plaid', 'ramp', 'brex', 'anduril', 'scaleai'],
    api: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
    pick: (j) => (Array.isArray(j) ? j : []).map((x) => ({ url: x.applyUrl || `${x.hostedUrl}/apply`, title: x.text })),
  },
  {
    ats: 'smartrecruiters',
    tokens: ['Visa', 'Bosch', 'Square', 'McDonalds'],
    api: (t) => `https://api.smartrecruiters.com/v1/companies/${t}/postings`,
    pick: (j, t) =>
      (j.content ?? []).map((x) => ({ url: `https://jobs.smartrecruiters.com/${t}/${x.id}`, title: x.name })),
  },
  {
    ats: 'recruitee',
    tokens: ['tandemdiabetescare', 'catawiki', 'usabilla'],
    api: (t) => `https://${t}.recruitee.com/api/offers/`,
    pick: (j, t) =>
      (j.offers ?? []).map((x) => ({ url: `https://${t}.recruitee.com/o/${x.slug}/c/new`, title: x.title })),
  },
  {
    ats: 'workday',
    tokens: ['nvidia|nvidia|NVIDIAExternalCareerSite', 'salesforce|salesforce|External_Career_Site'],
    api: (t) => {
      const [tenant] = t.split('|');
      return `https://${tenant}.wd5.myworkdayjobs.com/wday/cxs/${tenant}/${t.split('|')[2]}/jobs`;
    },
    pick: () => [], // handled specially below (needs POST) — placeholder
  },
  {
    ats: 'workable',
    tokens: ['gorgias', 'sword-health', 'remote'],
    api: (t) => `https://apply.workable.com/api/v1/widget/accounts/${t}?details=true`,
    pick: (j, t) =>
      (j.jobs ?? []).map((x) => ({ url: `https://apply.workable.com/${t}/j/${x.shortcode}/apply/`, title: x.title })),
  },
];

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify in a REAL browser: most modern ATS (Ashby, SmartRecruiters, Workday) render the form with JS,
 * so a raw fetch sees zero inputs. We count fields the way an extension would — after the SPA renders.
 */
let browser;
async function verify(url) {
  if (!browser) {
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch();
  }
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(2500); // let the SPA paint its form
    const n = await page.evaluate(
      () =>
        [...document.querySelectorAll('input,textarea,select')].filter((e) => {
          const el = e;
          const r = el.getBoundingClientRect();
          return el.type !== 'hidden' && r.height > 0 && r.width > 0;
        }).length,
    );
    return { ok: n >= 3, why: `${n} visible fields` };
  } catch (e) {
    return { ok: false, why: String(e).split('\n')[0].slice(0, 42) };
  } finally {
    await page.close().catch(() => {});
  }
}

const out = [];
for (const src of SOURCES) {
  let got = 0;
  for (const token of src.tokens) {
    if (got >= PER) break;
    const j = await getJson(src.api(token));
    if (!j) continue;
    let cands = [];
    try {
      cands = src.pick(j, token).filter((c) => c.url?.startsWith('http'));
    } catch {
      continue;
    }
    for (const c of cands.slice(0, 6)) {
      if (got >= PER) break;
      const v = await verify(c.url);
      console.log(`  ${v.ok ? '✓' : '✗'} [${src.ats}/${token}] ${v.why.padEnd(16)} ${c.url.slice(0, 78)}`);
      if (v.ok) {
        out.push({ ats: src.ats, company: token, title: c.title ?? '', url: c.url });
        got++;
      }
    }
  }
  if (!got) console.log(`  ⚠️  ${src.ats}: no live target found`);
}

const file = path.join(DIR, 'targets.live.json');
writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), targets: out }, null, 2) + '\n');
if (browser) await browser.close();
console.log(`\n${out.length} live targets → ${file}`);
for (const t of out) console.log(`  ${t.ats.padEnd(16)} ${t.url}`);
