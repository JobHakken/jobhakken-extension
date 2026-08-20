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
const CONCURRENCY = Number(arg('--concurrency', 8));
const JITTER_MIN = Number(arg('--jitter-min', 5000));
const JITTER_MAX = Number(arg('--jitter-max', 15000));
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
  // Token lists below are LIVE-VERIFIED (2026-08-19: each returned >0 postings from its own API right
  // before this run) rather than guessed company names — the prior guessed lists were mostly dead
  // (e.g. Lever: 4/20 live; most former Lever customers have since moved to Ashby/Greenhouse). A token
  // that 404s or returns an empty list is a company that left the platform, not a harvester bug.
  lever: {
    tokens: [
      'spotify',
      'palantir',
      'angellist',
      'secureframe',
      'lifestance',
      'shieldai',
      'paytm',
      'wealthfront',
      'outreach',
      'walkme',
      'matillion',
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
      'openai',
      'notion',
      'replit',
      'posthog',
      'cursor',
      'modal',
      'baseten',
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
  // Much thinner real footprint than Greenhouse/Ashby among companies searched — reflects actual market
  // share, not under-searching. Held to the same verification bar rather than padded with dead guesses.
  smartrecruiters: {
    tokens: ['Visa', 'BoschGroup', 'KimberlyClark', 'McDonaldsCorporation', 'Accor'],
    list: (t) =>
      json(`https://api.smartrecruiters.com/v1/companies/${t}/postings`).then((j) =>
        (j?.content ?? []).map((x) => `https://jobs.smartrecruiters.com/${t}/${x.id}`),
      ),
  },
  workable: {
    tokens: ['persado', 'blueground', 'skroutz', 'aha'],
    list: (t) =>
      json(`https://apply.workable.com/api/v1/widget/accounts/${t}?details=true`).then((j) =>
        (j?.jobs ?? []).map((x) => `https://apply.workable.com/${t}/j/${x.shortcode}/apply/`),
      ),
  },
  recruitee: {
    tokens: ['channable', 'bunq', 'personio'],
    list: (t) =>
      json(`https://${t}.recruitee.com/api/offers/`).then((j) =>
        (j?.offers ?? []).map((x) => `https://${t}.recruitee.com/o/${x.slug}/c/new`),
      ),
  },
};

function readForm() {
  const norm = (s) =>
    (s ?? '')
      .replace(/[*✱]/g, '') // Lever renders its required-field marker as U+2731, not a plain asterisk
      .replace(/\s+/g, ' ')
      .replace(/[:?.]+$/g, '')
      .trim();
  // A <label> that WRAPS its control (`<label>Gender <select>...</select></label>`, common on Lever)
  // puts the control INSIDE the label element, so `label.textContent` walks through every <option> too
  // — "Gender" becomes "GenderMaleFemaleDecline to self-identify". Three DIFFERENT shapes of this bug
  // showed up: <option> text bleeding straight in; a plain <div> SIBLING of the control inside the same
  // label carrying unrelated help text (Lever's EEO race field — several paragraphs of "A person having
  // origins in..." explainer); and Workable's phone field, where the "control" is a div-based
  // role="combobox" widget (the same permanently-mounted intl-tel-input country list seen contaminating
  // Greenhouse) with NO <select>/<option> tags anywhere — "Phone" became
  // "Phone+1United States+1United Kingdom+44Canada...", all ~200 countries concatenated in.
  //
  // Rather than keep blacklisting element types one bug at a time, collect text in DOCUMENT ORDER and
  // STOP ENTIRELY at the first thing that looks like a control anywhere in the subtree — by tag OR by
  // ARIA role, since custom widgets often aren't a real <select> at all. The question text always
  // precedes its own control. A length cap is the backstop for whatever pattern #4 turns out to be.
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
  const out = [],
    seen = new Set();
  let hidCounter = 0;

  // Radio/checkbox GROUPS are one question with several choices ("Race": Hispanic/White/Black/...), but
  // walking inputs one at a time treats each choice as its OWN standalone field — "Native Hawaiian or
  // Other Pacific Islander (Not Hispanic or Latino)" showed up as an independent question on Ashby, when
  // it's really one option inside a "Race" radiogroup (radio: 292 instances on Ashby alone; every
  // platform here except Greenhouse — which implements EEO questions as react-select comboboxes instead
  // — uses native radios/checkboxes for exactly this kind of question). Consolidate BEFORE the per-field
  // loop: group same-name radios (always a real group) and same-name checkboxes with 2+ members (a
  // genuine multi-select — a lone checkbox is a toggle like "I agree", not a group) into one field with
  // an options list, the same shape a native <select> already produces.
  const consumed = new Set();
  // Lever's custom per-company screening questions ("cards[<uuid>][field0]") use no <fieldset> and no
  // ARIA labelling at all — the heading lives in a SIBLING of the field's own container, one level up
  // (`<li class="application-question"><div>Are you legally authorized...?</div><div
  // class="application-field">...radios...</div></li>`), so `[class*="field" i]` alone finds only the
  // inner wrapper that never contains the heading. Try the broader "question" container first — the
  // length cap below is what keeps an over-broad match (one that swept in more than one question) from
  // being trusted, not this ordering alone.
  const groupContainer = (el) =>
    el.closest('fieldset') ||
    el.closest('[role="radiogroup"]') ||
    el.closest('[class*="question" i]') ||
    el.closest('[class*="field" i]') ||
    el.parentElement?.parentElement ||
    el.parentElement;
  // A real question header ("Race", "Veteran Status") is always short. Three different places actually
  // hold it, in priority order: Workable points `aria-labelledby` on the radiogroup at a completely
  // separate element elsewhere in the DOM (not a descendant at all, so nothing short of resolving the id
  // finds it) — checking only `aria-label` missed this silently. Ashby wraps the group in a <fieldset>
  // whose FIRST child is a <label> naming the question, but querying `fieldset label` without care
  // instead matches Workable's PER-OPTION label ("YES" — Workable wraps each individual choice in its
  // own <label>, not just the group heading), which then gets used as if it were the whole question — a
  // wrapper label always has an <input> as its first child, a heading label never does, so that
  // distinguishes them. And a <div class="description"> sitting in the same fieldset before any radio
  // carries paragraphs of EEO explainer text that a naive container walk absorbs too ("Race" became
  // "RaceHispanic or Latino - A person of Cuban, Mexican..."). So: resolve aria-labelledby first (most
  // authoritative, whether on the fieldset or on any role=radiogroup ancestor), then legend, then a
  // fieldset label ONLY if it isn't itself a per-choice wrapper, then the whole-container walk as a last
  // resort — the last two capped at a length no real header should exceed.
  const GROUP_LABEL_CAP = 80;
  const labelledBy = (el) => {
    const id = el?.getAttribute('aria-labelledby');
    if (!id) return '';
    const target = document.getElementById(id.split(/\s+/)[0]);
    return norm(cleanText(target) || target?.textContent || '');
  };
  const groupLabel = (els) => {
    for (const el of els) {
      const fs = el.closest('fieldset');
      const rg = el.closest('[role="radiogroup"]');
      const byId = labelledBy(fs) || labelledBy(rg);
      if (byId && byId.length <= GROUP_LABEL_CAP) return byId;
      const al = fs?.getAttribute('aria-label') || rg?.getAttribute('aria-label');
      if (al) return norm(al);
      const legend = norm(cleanText(fs?.querySelector('legend')));
      if (legend && legend.length <= GROUP_LABEL_CAP) return legend;
      const label = fs?.querySelector('label');
      if (label && !label.querySelector('input,select,textarea')) {
        const t = norm(cleanText(label));
        if (t && t.length <= GROUP_LABEL_CAP) return t;
      }
    }
    let best = '';
    for (const el of els) {
      const t = norm(cleanText(groupContainer(el)));
      if (t && t.length <= GROUP_LABEL_CAP && t.length > best.length) best = t;
    }
    return best;
  };
  // The heading walk above stops at the FIRST control on purpose (so trailing help text never gets
  // swept in) — but a per-option choice label needs the OPPOSITE handling: Workable wraps each radio as
  // `<label><input/><span>YES</span></label>`, control first, visible text after, so stopping at the
  // first control returns nothing. An option's own text never has a further nested control inside it,
  // so it's safe here to simply remove the input from a clone rather than stop-and-discard.
  const optionText = (el) => {
    const l = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    if (!l) return norm(el.getAttribute('aria-label') || el.value || '');
    const clone = l.cloneNode(true);
    clone.querySelectorAll('input,select,textarea,button').forEach((n) => n.remove());
    return norm(clone.textContent) || norm(el.getAttribute('aria-label') || el.value || '');
  };
  for (const kind of ['radio', 'checkbox']) {
    const byName = new Map();
    for (const el of document.querySelectorAll(`input[type="${kind}"]`)) {
      if (el.getBoundingClientRect().height === 0 || !el.name) continue;
      if (!byName.has(el.name)) byName.set(el.name, []);
      byName.get(el.name).push(el);
    }
    for (const els of byName.values()) {
      if (els.length < 2) continue; // a lone checkbox/radio isn't a group
      const label = norm(groupLabel(els) || els[0].name);
      if (!label || label.length < 2) continue;
      const k = label.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      for (const el of els) consumed.add(el);
      out.push({
        label,
        kind: kind === 'radio' ? 'radiogroup' : 'checkboxgroup',
        required: els.some((el) => el.required),
        id: null,
        clickId: null,
        widgetId: null,
        options: els.map(optionText).filter(Boolean),
      });
    }
  }

  for (const el of document.querySelectorAll('input,select,textarea')) {
    if (consumed.has(el)) continue;
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
    // Ashby's combobox inputs carry role="combobox" but no `id` at all — an id-based click selector
    // silently matches nothing and the field's options never get captured. Stamp every combobox with a
    // data attribute we control so there is always something reliable to click on, id or not.
    let clickId = el.id || null;
    if (kind === 'combobox' && !clickId) {
      clickId = `jh-hid-${hidCounter++}`;
      el.setAttribute('data-jh-hid', clickId);
    }
    out.push({
      label,
      kind,
      required: el.required || /\*/.test(el.closest('[class*="field"]')?.querySelector('label')?.textContent ?? ''),
      id: el.id || null,
      clickId,
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

const OPTION_CAP = 300;

/**
 * Read what ONE dropdown offers, without trusting any selector to be scoped to it, and tell the
 * difference between "here is the complete answer" and "here is a sample of a search field."
 *
 * First cut used a global `[class*="option"],[role="option"]` query, and it was wrong: Greenhouse
 * permanently mounts a phone country-code picker (intl-tel-input) whose ~200 <li> items carry
 * role="option" unconditionally, click or no click. Fixed with a before/after diff: snapshot
 * option-like nodes before the click, again after, keep only what is NEW and currently visible.
 * Universal across ATS DOM conventions — it does not depend on knowing where any given vendor mounts
 * its menu.
 *
 * Second cut probed "is this a search field" by typing a nonsense query and checking whether the
 * result count shrank. That was wrong in a way that broke silently: nearly every combobox widget
 * filters on typed text as a generic convenience, whether the backing list is 3 fixed items or a
 * 10,000-row virtualized one — so the probe returned true for almost everything. What actually tells
 * them apart is whether the list is DONE GROWING once scrolling stops: a fixed list (Gender, Country)
 * plateaus after a scroll or two; a real virtualized typeahead (School) keeps rendering more on every
 * scroll; a pure search field (no default list at all) starts empty. Track the option count after each
 * scroll and use that shape, not a type-and-recount side-quest.
 */
async function optionsFor(page, clickId) {
  openTried++;
  // clickId is either the element's real `id` or a synthetic `jh-hid-N` we stamped via readForm() on
  // Ashby-style comboboxes that carry role="combobox" but no id at all.
  const selector = clickId.startsWith('jh-hid-') ? `[data-jh-hid="${clickId}"]` : `[id="${clickId}"]`;
  try {
    // page.evaluate() does not reliably round-trip a Set through Playwright's serialization boundary —
    // it comes back unusable in Node. Return a plain array and build the Set on this side.
    const beforeArr = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="option"],[role="option"]')].map((o) => o.textContent.trim()),
    );
    const before = new Set(beforeArr);
    await page.click(selector, { timeout: 2500 });
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
    for (let i = 0; i < 6; i++) {
      const n = await page.evaluate(() => {
        const opts = [...document.querySelectorAll('[role="option"]')];
        const last = opts[opts.length - 1];
        const menu = last?.closest('[class*="menu" i],[class*="Menu"]') ?? last?.parentElement;
        if (menu) menu.scrollTop = menu.scrollHeight;
        last?.scrollIntoView?.();
        return opts.length;
      });
      await page.waitForTimeout(250);
      counts.push((await countNew()).length);
      if (n === counts[counts.length - 2] && counts.length > 3) break; // stable for a beat — stop early
    }
    const finalItems = await countNew();
    const sample = finalItems.slice(0, OPTION_CAP);

    const startedEmpty = counts[0] === 0;
    const stillGrowing = counts.length > 1 && counts[counts.length - 1] > counts[counts.length - 2];
    const hitCap = finalItems.length >= OPTION_CAP;
    const searchable = startedEmpty || stillGrowing || hitCap;

    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(180);
    if (sample.length) openOk++;
    return { options: sample, searchable };
  } catch {
    return { options: [], searchable: false };
  }
}

/**
 * Fetch every company's listing CONCURRENTLY, then work one flat queue of (token, url) items with N
 * concurrent tabs — the same pattern proven on the Greenhouse harvester (10.6min -> 4min at 45 forms).
 * Jitter before each item desynchronizes the workers' request timing without limiting throughput.
 */
console.log(`  fetching ${src.tokens.length} ${ATS} listings concurrently…`);
const listings = await Promise.all(
  src.tokens.map(async (token) => ({
    token,
    urls: ((await src.list(token)) ?? []).filter((u) => typeof u === 'string' && u.startsWith('http')).slice(0, PER),
  })),
);
for (const { token, urls } of listings) if (!urls.length) console.log(`  –  ${token}: none`);

const queue = [];
for (const { token, urls } of listings) for (const url of urls) queue.push({ token, url });
queue.length = Math.min(queue.length, MAX);
console.log(`  ${queue.length} postings queued across ${listings.filter((l) => l.urls.length).length} companies\n`);

let cursor = 0;
const boardKept = {};
const jitter = () => JITTER_MIN + Math.random() * (JITTER_MAX - JITTER_MIN);

async function worker() {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1300, height: 950 });
  while (cursor < queue.length && forms < MAX) {
    const item = queue[cursor++];
    if (!item) break;
    const { token, url } = item;
    await page.waitForTimeout(jitter());
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
        if (f.kind !== 'combobox' || !f.clickId || f.options.length) continue;
        const r = await optionsFor(page, f.clickId);
        f.options = r.options;
        f.searchable = r.searchable;
      }
      forms++;
      (boardKept[token] ??= []).push({ url, fields: fields.length });
      // Object mutation here is safe under concurrency: nothing awaits between the read and the write in
      // this block, and JS only switches tasks at an `await` — two workers can never interleave mid-update.
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
          searchable: false,
        });
        q.seen++;
        q.kinds[f.kind] = (q.kinds[f.kind] ?? 0) + 1;
        if (f.required) q.required++;
        if (!q.boards.includes(token)) q.boards.push(token);
        if (f.widgetId && !q.widgetIds.includes(f.widgetId)) q.widgetIds.push(f.widgetId);
        if (f.id && !/^\d/.test(f.id) && !q.fieldIds.includes(f.id)) q.fieldIds.push(f.id);
        if (f.searchable) q.searchable = true;
        if (f.options.length > q.options.length) q.options = f.options.slice(0, OPTION_CAP);
      }
      console.log(
        `  ✓ ${token.padEnd(20)} ${forms}/${queue.length} forms · ${Object.keys(corpus.questions).length} questions`,
      );
    } catch {
      /* posting closed or blocked */
    }
  }
  await page.close();
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
corpus.boards = boardKept;
await browser.close();

corpus.questions = Object.fromEntries(Object.entries(corpus.questions).sort((a, b) => b[1].seen - a[1].seen));
corpus.dropdownOpenRate = openTried ? Math.round((openOk / openTried) * 100) : null;
const out = `e2e/fixtures/${ATS}-corpus.json`;
writeFileSync(out, JSON.stringify(corpus, null, 2) + '\n');
const withOpts = Object.values(corpus.questions).filter((v) => v.options.length).length;
console.log(
  `\n[${ATS}] ${forms} forms · ${Object.keys(corpus.questions).length} questions · ${withOpts} with options · dropdown open rate ${corpus.dropdownOpenRate}% → ${out}`,
);
