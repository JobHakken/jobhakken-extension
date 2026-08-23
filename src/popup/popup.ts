import { getAiConfigMeta, hasAiKey } from '../lib/aiKeyStore.js';
import { estCostUsd, fmtCost, fmtTokens, getMonthUsage, recordDraft, totalTokens } from '../lib/aiUsageStore.js';
import { markReviewShown, recordMeaningfulFill, REVIEW_URL, shouldPromptReview } from '../lib/reviewStore.js';
import { isPaidTier, loadIdentity, LOGIN_URL } from '../lib/authStore.js';
import { loadConnection } from '../lib/connectionStore.js';
import { bestFrameId } from '../lib/frameStore.js';
import type { H1bDetail } from '../lib/h1bTypes.js';
import { escapeHtml } from '../lib/html.js';
import { loadTestMode } from '../lib/profileStore.js';
import { hostHash } from '../lib/siteDiscovery.js';
import { getTelemetryEnabled } from '../lib/telemetry.js';
import { report } from '../lib/telemetryClient.js';
import { initThemeToggle } from '../lib/theme.js';

/**
 * Toolbar popup — the extension's control center (replaces the old floating on-page panel,
 * which was fragile on SPA re-renders). It drives the active tab's content script over a
 * small RPC (chrome.tabs.sendMessage → 'f2a-rpc'); all page work still happens in the
 * content script. Always reachable from the toolbar icon regardless of the page's DOM.
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type EligCat = 'citizenship' | 'clearance' | 'sponsorship' | 'export';
type State = {
  mode: 'connected' | 'standalone' | 'none';
  fields: number;
  relevant: boolean;
  job?: { title?: string; company?: string; url?: string };
  atsPlatform?: string | null;
  testMode?: boolean;
  captureMode?: boolean;
  captureSite?: { show: boolean; optedIn: boolean };
  eligibility?: { blocked: boolean; categories: EligCat[] } | null;
  h1b?: { company: string; approvals: number } | null;
};
type Insights = { ats?: number | null; visa?: string; keywords?: { have: string[]; gap: string[] }; error?: string };

const ELIG_LABELS: Record<EligCat, string> = {
  citizenship: 'U.S. citizenship',
  clearance: 'a security clearance',
  sponsorship: 'no visa sponsorship',
  export: 'export-control (ITAR/EAR)',
};

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/**
 * Call the active tab's content script — targeting the FORM frame by frameId. The content
 * script runs in every frame (all_frames), so a bare sendMessage would be delivered to all
 * of them and the empty top frame's reply could win; frameStore tells us which frame holds
 * the fields. Returns null if there's no content script (chrome://, etc.).
 */
async function rpc<T>(method: string, params?: unknown): Promise<T | null> {
  const id = await activeTabId();
  if (id == null) return null;
  const frameId = await bestFrameId(id);
  const send = async (fid: number | null | undefined) =>
    (await chrome.tabs.sendMessage(id, { type: 'f2a-rpc', method, params }, fid != null ? { frameId: fid } : {})) as T;
  try {
    return await send(frameId);
  } catch {
    // No content script answered. The usual cause is that this tab was open when the extension
    // reloaded/updated — Chrome leaves the old script running but severed, so the page looks
    // dead to us (#150). Re-inject once and retry before giving up; frameStore's remembered
    // frameId belongs to the OLD injection, so retry against all frames.
    const ok = await chrome.runtime
      .sendMessage({ type: 'f2a-reinject', tabId: id })
      .then((r: { ok?: boolean } | undefined) => !!r?.ok)
      .catch(() => false);
    if (!ok) return null;
    try {
      return await send(null);
    } catch {
      return null;
    }
  }
}

// Use the shared escaper (also escapes ') so all dynamic-HTML sinks share one correct guarantee (#15).
const esc = escapeHtml;

// ── Coverage Layer 2: discover unsupported ATS (#105/#278) ─────────────────────────────────────────
// Salt injected at build time (release only); empty in dev/CI keeps discovery inert. Replaced by
// esbuild `define`; `typeof` guard keeps it safe under jest.
declare const __SITE_HASH_SALT__: string;
const SITE_HASH_SALT = typeof __SITE_HASH_SALT__ !== 'undefined' ? __SITE_HASH_SALT__ : '';

/**
 * Injected into the active tab (activeTab, on the user's toolbar click) to decide whether the page is a
 * job-application form + guess the ATS family. Self-contained — runs in the page world, no imports. It
 * reads only structure/markers; the RETURN value is a boolean + a bounded enum string, never any page
 * content, and nothing here is persisted or transmitted from the page.
 */
function jobFormHeuristic(): { isJobForm: boolean; atsGuess: string } {
  const html = document.documentElement.outerHTML;
  const txt = (document.body?.innerText || '').slice(0, 20000).toLowerCase();
  let atsGuess = 'unknown';
  const markers: [RegExp, string][] = [
    [/data-automation-id|myworkdayjobs|workday/i, 'workday'],
    [/grnhse|greenhouse\.io/i, 'greenhouse'],
    [/jobs\.lever\.co|leverapp|\blever\b/i, 'lever'],
    [/icims/i, 'icims'],
    [/ashbyhq|\bashby\b/i, 'ashby'],
    [/smartrecruiters/i, 'smartrecruiters'],
    [/workable/i, 'workable'],
    [/taleo/i, 'taleo'],
    [/successfactors|sfsf/i, 'successfactors'],
    [/bamboohr/i, 'bamboohr'],
    [/jobvite/i, 'jobvite'],
  ];
  for (const [re, name] of markers) {
    if (re.test(html)) {
      atsGuess = name;
      break;
    }
  }
  const inputs = document.querySelectorAll('input, textarea, select').length;
  const hasFile = !!document.querySelector('input[type="file"]');
  const hasEmail = !!document.querySelector('input[type="email"]') || /\be-?mail\b/.test(txt);
  const applyish = /(apply|application|resume|résumé|\bcv\b|cover letter|job|position|candidate|employment)/.test(txt);
  const signals = [inputs >= 4, hasFile, hasEmail, applyish].filter(Boolean).length;
  // Known-ATS markup is strong on its own; otherwise require several independent job-form signals.
  const isJobForm = atsGuess !== 'unknown' ? inputs >= 2 : signals >= 3 && (hasFile || hasEmail);
  return { isJobForm, atsGuess };
}

/**
 * On an UNSUPPORTED page (no content script), when the user opens the popup, report a coverage
 * candidate so we learn which ATS to support next — a SALTED HASH of the registrable domain + a coarse
 * ATS guess, never the host/URL/company/content. Gated by: a build salt (release only), the analytics
 * opt-out, an http(s) page, and a 7-day per-host dedupe so we don't re-emit. We only touch the page
 * (inject the heuristic) AFTER those gates pass — so an opted-out user's page is never read.
 */
async function reportSiteCandidate(): Promise<void> {
  try {
    if (!SITE_HASH_SALT) return; // dev/CI build → inert
    if (!(await getTelemetryEnabled())) return; // respect the analytics opt-out
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;
    let url: URL;
    try {
      url = new URL(tab.url);
    } catch {
      return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return; // skip chrome://, file://, extensions
    const hash = await hostHash(url.hostname, SITE_HASH_SALT);
    if (!hash) return;
    // Dedupe: a given host is reported at most once per 7 days (don't re-emit on every popup open).
    const SEEN = 'f2a_site_seen';
    const store = ((await chrome.storage.local.get(SEEN))[SEEN] as Record<string, number>) ?? {};
    const now = Date.now();
    if (store[hash] && now - store[hash] < 7 * 864e5) return;
    // Gates passed → NOW read the page (activeTab-scoped, one tab, this once).
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: jobFormHeuristic });
    const out = res?.result as { isJobForm: boolean; atsGuess: string } | undefined;
    if (!out?.isJobForm) return;
    report('site_candidate', { host_hash: hash, ats_guess: out.atsGuess });
    store[hash] = now;
    // Cap the dedupe map so it can't grow unbounded (keep the 200 most-recent).
    const kept = Object.entries(store)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200);
    await chrome.storage.local.set({ [SEEN]: Object.fromEntries(kept) });
  } catch {
    /* discovery is best-effort — never break the popup */
  }
}

// Public repo so anyone can file feedback (the main jobhakken repo is private → 404 for users).
const REPO = 'https://github.com/JobHakken/JobHakken-issues';
let lastState: State | null = null;
// H-1B history panel (premium): company on the current page + whether this user may see the data.
let h1bCompany = '';
let h1bEntitled = false;
let h1bLoadedFor = '';

$('ver').textContent = `v${chrome.runtime.getManifest().version}`;
$('gear').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('setupCta').addEventListener('click', () => chrome.runtime.openOptionsPage());
// Open the in-page rail (#140). The rail lives in the PAGE, not in browser chrome, so this just asks
// the content script to show it — and the launcher tab on the page edge is the primary way in anyway.
$('panel').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { type: 'f2a-open-rail' });
    window.close();
  } catch {
    /* no content script here (chrome://, store pages) — nothing to open */
  }
});

void initThemeToggle($('theme'));

async function render() {
  const [state, conn, testMode, identity] = await Promise.all([
    rpc<State>('getState'),
    loadConnection(),
    loadTestMode(),
    loadIdentity(),
  ]);
  lastState = state;

  if (!state) {
    $('connLabel').textContent = 'Open a job page';
    $('foot').innerHTML =
      'First time? <b>Set up your profile</b>, then open any job application and click Autofill. JobHakken works on job boards and application pages.';
    // NB: these are real element ids (an earlier list included a phantom "fill2" — a class, not an
    // id — so $('fill2') was null and this whole branch threw before disabling Autofill / showing
    // the CTA; the empty state only looked right thanks to default CSS).
    (['insights', 'h1bPanel', 'mini', 'siteCapRow', 'captureRow'] as const).forEach((id) =>
      $(id).classList.add('hidden'),
    );
    $('setupCta').classList.remove('hidden'); // give first-run / off-a-job-page users a way forward
    $('siteHint').classList.remove('on');
    ($('autofill') as HTMLButtonElement).disabled = true;
    void reportSiteCandidate(); // learn about unsupported ATS the user actually visits (#105/#278)
    return; // the ⚑ Report block stays available (this is the "not detected" case)
  }

  // On a job page but no profile yet → still surface the setup CTA (dead-end #2). Otherwise hide it.
  $('setupCta').classList.toggle('hidden', state.mode !== 'none');

  const connected = state.mode === 'connected';
  const testOn = !!state.testMode || testMode;

  // connection line (mask the real identity in test mode)
  $('conn').className = `conn ${state.mode}`;
  $('connLabel').textContent = connected
    ? testOn
      ? '🧪 Demo mode'
      : (conn?.profile?.basics?.name ?? 'Connected')
    : state.mode === 'standalone'
      ? 'App not connected'
      : 'Profile not set up';

  $('testbar').classList.toggle('on', testOn);

  // job line
  const job = state.job;
  const jl = $('jobline');
  if (job && (job.title || job.company)) {
    jl.classList.add('on');
    jl.innerHTML = `📍 <b>${esc(job.title || job.company || '')}</b>${job.title && job.company ? ` · ${esc(job.company)}` : ''}`;
  } else jl.classList.remove('on');

  // sponsorship verdict — compact chip; hover (title) explains it
  const elig = $('elig');
  if (state.eligibility?.blocked) {
    elig.classList.add('on');
    elig.textContent = "🛂 Won't sponsor";
    elig.title = `Likely won't sponsor — this role requires ${state.eligibility.categories
      .map((c) => ELIG_LABELS[c])
      .filter(Boolean)
      .join(', ')}.`;
  } else elig.classList.remove('on');

  // H-1B sponsor (company-level) — green chip; hover explains the caveat
  const h1b = $('h1b');
  if (state.h1b && state.h1b.approvals > 0) {
    h1b.classList.add('on');
    h1b.textContent = `✓ Sponsors visas${state.h1b.approvals >= 5 ? ` · ${state.h1b.approvals.toLocaleString()}` : ''}`;
    h1b.title = `${state.h1b.company} has ${state.h1b.approvals.toLocaleString()} H-1B approval(s) on record. Company-level signal — a specific role may still not sponsor.`;
  } else h1b.classList.remove('on');

  // H-1B history panel — PREMIUM: only paid/builder tier OR desktop-connected. Data lazy-loads on expand.
  h1bCompany = state.job?.company || state.h1b?.company || '';
  h1bEntitled = isPaidTier(identity?.tier) || connected;
  const h1bPanel = $('h1bPanel');
  if (!h1bCompany) {
    h1bPanel.classList.add('hidden');
  } else {
    h1bPanel.classList.remove('hidden');
    if (!h1bEntitled) {
      $('h1bPeek').textContent = '🔒 Builder';
      $('h1bBody').innerHTML =
        `<div>See <b style="color:var(--fg)">H-1B salary &amp; filing history</b> for ${esc(h1bCompany)} — sponsored roles, typical wages, and how many petitions they've filed.</div>` +
        `<div style="margin-top:8px"><a id="h1bUpsell" href="#" style="color:var(--accent);font-weight:600">Sign in with a builder account →</a> <span style="color:var(--muted)">or connect the desktop app</span></div>`;
      $('h1bUpsell')?.addEventListener('click', (e) => {
        e.preventDefault();
        void chrome.tabs.create({ url: LOGIN_URL });
      });
    } else if (h1bLoadedFor !== h1bCompany) {
      $('h1bPeek').textContent = '';
      $('h1bBody').textContent = 'Expand to see this company’s H-1B history.';
    }
  }

  $('fieldCount').textContent = String(state.fields);

  // "Autofill + AI" is always available (BYO key or desktop); it just drafts the open-ended answers
  // after filling. connected-only surfaces:
  $('insights').classList.toggle('hidden', !connected);
  // The Draft-answers row shows when the desktop is connected OR a BYO AI key is set (standalone AI) —
  // otherwise the key would be unreachable from the UI. "Save job" is desktop-only, so hide it alone.
  const hasKey = await hasAiKey();
  $('mini').classList.toggle('hidden', !(connected || hasKey));
  $('save').classList.toggle('hidden', !connected);

  // "run on this site" — for job/career sites we don't auto-detect
  const cs = state.captureSite;
  $('siteCapRow').classList.toggle('on', !!cs?.show);
  $('siteHint').classList.toggle('on', !!cs?.show && !cs?.optedIn);
  if (cs?.show) {
    ($('siteCap') as HTMLInputElement).checked = cs.optedIn;
    $('siteCapLabel').textContent = cs.optedIn
      ? '✓ Always running on this site'
      : '➕ Always run JobHakken on this site';
  }
  $('captureRow').classList.toggle('hidden', !state.captureMode);

  $('foot').innerHTML = connected
    ? 'Never auto-submits — you review first. AI runs through your desktop app.'
    : hasKey
      ? 'Draft answers uses your own AI key. Never auto-submits — you review first.'
      : state.mode === 'standalone'
        ? 'Connect the desktop app (Settings) for a résumé match, visa signal &amp; a tailored résumé.'
        : 'Add your profile in Settings to autofill. Connect the app for AI + résumé.';
}

// ── actions ──────────────────────────────────────────────
// Autofill can be slow when it renders an AI-tailored résumé — so while it runs, the button
// becomes "✕ Cancel" (a second click aborts it), and there's a hard timeout so it never hangs.
let filling = false;
type FillResult = { filled: number; review: number; total: number; partial?: boolean; aiMapped?: number } | null;
// Last autofill outcome this popup saw — folded into a bug report so "autofill missed fields" arrives
// with the actual numbers instead of a description.
let lastFill: { filled: number; review: number; total: number; partial?: boolean } | null = null;
async function runFill(btn: HTMLButtonElement, mode: 'default' | 'ats') {
  if (filling) {
    // acts as Cancel — the pending autofill RPC then resolves (partial) and resets the UI
    await rpc('cancelAutofill');
    return;
  }
  filling = true;
  const other = (btn.id === 'autofill' ? $('autofillAi') : $('autofill')) as HTMLButtonElement;
  other.disabled = true;
  const big = btn.querySelector('.big') as HTMLElement;
  const sm = btn.querySelector('.sm') as HTMLElement;
  const prevBig = big.textContent;
  const prevSm = sm?.textContent ?? '';
  big.textContent = '✕ Cancel';
  if (sm) sm.textContent = mode === 'ats' ? 'tailoring…' : 'filling…';
  btn.classList.add('canceling');

  // safety net in case the content script itself is gone (content already self-bounds to 20/45s)
  const timeoutMs = mode === 'ats' ? 50_000 : 24_000;
  const r = (await Promise.race([
    rpc<FillResult>('autofill', { mode }),
    new Promise((res) => setTimeout(() => res('__timeout__'), timeoutMs)),
  ])) as FillResult | '__timeout__';

  // NB: we deliberately do NOT re-run the whole fill here (#136). The old heuristic — "re-run if the
  // page has more fields than we filled" — fired on every page we filled poorly, which is exactly the
  // pages users complain about, and measurably added zero fills while doubling the clicks dispatched
  // into the page (the visible "up and down"). Fields revealed by a gate are now handled inside the
  // content script by a debounced DOM-change watcher that fills only what actually appeared.

  filling = false;
  other.disabled = false;
  big.textContent = prevBig;
  if (sm) sm.textContent = prevSm;
  btn.classList.remove('canceling');

  if (r === '__timeout__') {
    $('fillResult').innerHTML = '<span class="chip rev">Timed out — try again</span>';
    lastFill = null;
    return;
  }
  lastFill = r; // remember for "Report this page"
  $('fillResult').innerHTML = r
    ? `<span class="chip ok">✓ ${r.filled} filled</span>${r.aiMapped ? `<span class="chip ai" title="Questions our rules didn't recognise, matched to your profile by your own AI key. Only field names were sent — never your values.">✨ ${r.aiMapped} matched by AI</span>` : ''}${r.review ? `<button class="chip jump" title="Scroll to the purple-outlined fields on the page">${r.review} to review →</button>` : ''}${r.partial ? '<span class="chip rev">partial — cancelled/slow</span>' : ''}${r.review ? '<div class="hint">Fields to check are outlined in purple on the page.</div>' : ''}`
    : 'Set up your profile in Settings first.';

  // Organic review prompt: after a couple of meaningful fills, offer a review once (ever).
  if (r && typeof r !== 'string' && r.filled >= 8 && !r.partial) {
    await recordMeaningfulFill();
    if (await shouldPromptReview()) {
      await markReviewShown();
      $('reviewBar').classList.remove('hidden');
    }
  }
}
// Review banner: open the Web Store reviews page, or dismiss — either way it never returns
// (markReviewShown was already called when it appeared).
$('reviewLink').addEventListener('click', (e) => {
  e.preventDefault();
  void chrome.tabs.create({ url: REVIEW_URL });
  $('reviewBar').classList.add('hidden');
});
$('reviewDismiss').addEventListener('click', () => $('reviewBar').classList.add('hidden'));

// Autofill — plain deterministic fill (tailored résumé too when the desktop app is connected).
($('autofill') as HTMLButtonElement).addEventListener('click', (e) =>
  runFill(e.currentTarget as HTMLButtonElement, lastState?.mode === 'connected' ? 'ats' : 'default'),
);
// Autofill + AI — fill, then draft the open-ended answers in one action. Adds a distinct "✍️ N AI
// answers" chip so it's clear what this button did beyond a plain Autofill (those are the purple ones).
($('autofillAi') as HTMLButtonElement).addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  await runFill(btn, lastState?.mode === 'connected' ? 'ats' : 'default');
  const drafted = await doDraft(null);
  if (drafted > 0) {
    $('fillResult').insertAdjacentHTML(
      'beforeend',
      `<span class="chip ai" title="Open-ended answers written by AI — outlined in purple to review">✍️ ${drafted} AI answer${drafted === 1 ? '' : 's'}</span>`,
    );
  }
});
// Jump to the fields that need review (outlined in amber on the page).
$('fillResult').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.jump')) void rpc('scrollToReview');
});

// H-1B history panel: fetch the premium detail from the SW the first time it's expanded (per company).
const h1bPanelEl = $('h1bPanel') as HTMLDetailsElement;
const money = (n: number) => (n ? `$${Math.round(n / 1000)}k` : '—');
h1bPanelEl.addEventListener('toggle', async () => {
  if (!h1bPanelEl.open || !h1bEntitled || !h1bCompany || h1bLoadedFor === h1bCompany) return;
  h1bLoadedFor = h1bCompany;
  const body = $('h1bBody');
  body.textContent = 'Looking up…';
  const resp = (await chrome.runtime
    .sendMessage({ type: 'f2a-h1b-detail', company: h1bCompany })
    .catch(() => null)) as { detail?: H1bDetail | null } | null;
  const d = resp?.detail ?? null;
  if (!d) {
    body.textContent = `No H-1B petitions on record for ${h1bCompany}.`;
    h1bLoadedFor = ''; // allow a retry on re-open
    return;
  }
  const wage = d.wageMedian
    ? ` · <b style="color:var(--fg)">~${money(d.wageMedian)}</b> typical${d.wageMin && d.wageMax ? ` <span style="color:var(--muted)">(${money(d.wageMin)}–${money(d.wageMax)})</span>` : ''}`
    : '';
  const table = d.roles.length
    ? `<div class="h1btbl-wrap"><table class="h1btbl"><thead><tr><th>Sponsored role</th><th>Filings</th><th>Wage</th></tr></thead><tbody>${d.roles
        .map(
          (r) =>
            `<tr><td title="${esc(r.title)}">${esc(r.title)}</td><td>${r.filings.toLocaleString()}</td><td>${r.wageMedian ? money(r.wageMedian) : '—'}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '';
  body.innerHTML =
    `<div class="lead"><b style="color:var(--fg)">${d.filings.toLocaleString()}</b> H-1B petition(s) for ${esc(h1bCompany)}${wage}</div>` +
    table +
    `<div style="font-size:10.5px;color:var(--muted)">Historical LCA filings across the company's entities — a company-level signal, not a guarantee for a specific role.</div>`;
  $('h1bPeek').innerHTML = `<span class="chip ok">${d.filings.toLocaleString()}</span>`;
});

const insights = $('insights') as HTMLDetailsElement;
let analyzed = false;
insights.addEventListener('toggle', async () => {
  if (!insights.open || analyzed) return;
  analyzed = true;
  const r = await rpc<Insights | null>('analyze');
  const body = $('insBody');
  if (!r || r.error) {
    body.textContent = r?.error ?? 'Could not analyze this page.';
    analyzed = false;
    return;
  }
  const parts: string[] = [];
  if (typeof r.ats === 'number') {
    parts.push(`<div><b style="color:var(--fg)">Résumé match: ${r.ats}%</b> for this job</div>`);
    $('insPeek').innerHTML = `<span class="chip ok">${r.ats}%</span>`;
  }
  if (r.visa) parts.push(`<div><span class="visa">🛂 ${esc(r.visa)}</span></div>`);
  // Guard the (content-script-derived) shape so a malformed response can't throw and wedge the panel (#16).
  const have = Array.isArray(r.keywords?.have) ? r.keywords.have : [];
  const gap = Array.isArray(r.keywords?.gap) ? r.keywords.gap : [];
  if (have.length || gap.length) {
    const chips = [
      ...have.slice(0, 6).map((k) => `<span class="have">${esc(String(k))}</span>`),
      ...gap.slice(0, 6).map((k) => `<span class="gap">${esc(String(k))}</span>`),
    ].join('');
    parts.push(
      `<div><div style="font-weight:700;margin-bottom:6px;color:var(--fg)">🎯 Keywords</div><div class="kw">${chips}</div></div>`,
    );
  }
  body.innerHTML = parts.length ? parts.join('') : 'No signal for this page.';
});

// Turn a terse internal error into plain guidance the user can act on. Falls back to the raw
// message (never truncated) rather than swallowing it. Keyed on substrings the content script /
// bridge return (e.g. "off in test mode", "No question field", "Open the JobHakken app…").
function friendlyError(raw: string | undefined, fallback: string): string {
  const e = (raw ?? '').toLowerCase();
  if (!raw) return fallback;
  if (e.includes('test mode') || e.includes('demo')) return 'Turn off Demo mode to use this on real data.';
  if (e.includes('question field') || e.includes('no question'))
    return "Couldn't find a question to answer on this page.";
  if (e.includes('connect') || e.includes('app') || e.includes('bridge') || e.includes('unreachable'))
    return 'Open the JobHakken desktop app first, then try again.';
  if (e.includes('profile')) return 'Set up your profile in Settings first.';
  return raw; // unknown — show the real message in full, don't chop it
}

// Show a result under the draft/save row, then reset the button label after a beat so the button
// never gets stuck in an error/"…" state (the old code left truncated errors on the button forever).
function showMiniResult(ok: boolean, msg: string): void {
  $('miniResult').innerHTML = `<span class="chip ${ok ? 'ok' : 'rev'}">${ok ? '✓' : '⚠'} ${esc(msg)}</span>`;
}

// Render this month's AI-draft usage under the mini row (on-device only; hidden until there's any).
async function renderAiUsage(): Promise<void> {
  const el = $('aiUsage');
  const m = await getMonthUsage();
  if (!m.drafts) {
    el.classList.add('hidden');
    return;
  }
  const tokens = totalTokens(m);
  const cost = fmtCost(estCostUsd(m.promptTokens, m.completionTokens));
  const parts = [`<b>${m.drafts}</b> draft${m.drafts === 1 ? '' : 's'} this month`];
  if (tokens) parts.push(`<b>${fmtTokens(tokens)}</b> tokens`, `≈ <b>${cost}</b>`);
  el.innerHTML = `🤖 ${parts.join(' · ')}`;
  el.classList.remove('hidden');
}

// Draft the open-ended answers. Reused by the "Draft answers" button and "Autofill + AI"; when called
// from the combined action (btn=null) a "no questions here" result is silent, not an error.
async function doDraft(btn: HTMLButtonElement | null): Promise<number> {
  const label = btn?.textContent ?? '✍️ Draft answers';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Drafting…';
  }
  const r = await rpc<{
    ok: boolean;
    filled?: number;
    usage?: { promptTokens: number; completionTokens: number } | null;
    error?: string;
  } | null>('draft');
  let drafted = 0;
  if (r?.ok) {
    drafted = r.filled ?? 1;
    await recordDraft(drafted, r.usage?.promptTokens ?? 0, r.usage?.completionTokens ?? 0);
    const tok = r.usage ? ` · ~${fmtTokens(totalTokens(r.usage))} tokens` : '';
    showMiniResult(
      true,
      `Drafted ${drafted} answer${drafted === 1 ? '' : 's'}${tok} — the purple-outlined AI answers are on the page to review.`,
    );
    await renderAiUsage();
    $('refineBox').classList.add('hidden'); // fresh draft → collapse any open refine box
    $('refineToggle').classList.remove('hidden'); // offer per-field refine
  } else if (!(btn === null && /no question/i.test(r?.error ?? ''))) {
    showMiniResult(false, friendlyError(r?.error, 'No open-ended questions to draft here.'));
  }
  if (btn) {
    btn.textContent = label;
    btn.disabled = false;
  }
  return drafted;
}
($('draft') as HTMLButtonElement).addEventListener('click', (e) => void doDraft(e.currentTarget as HTMLButtonElement));

// Per-field AI re-draft: pick a drafted question, tell the AI what to change, redo just that answer.
let draftedLabels: string[] = [];
$('refineToggle').addEventListener('click', async () => {
  const res = await rpc<{ items?: { label: string }[] }>('draftedList');
  draftedLabels = (res?.items ?? []).map((it) => it.label);
  if (!draftedLabels.length) {
    showMiniResult(false, 'Draft answers first, then refine.');
    return;
  }
  ($('refinePick') as HTMLSelectElement).innerHTML = draftedLabels
    .map((l, i) => `<option value="${i}">${esc(l.length > 60 ? l.slice(0, 57) + '…' : l)}</option>`)
    .join('');
  $('refineToggle').classList.add('hidden');
  $('refineBox').classList.remove('hidden');
});
$('refineGo').addEventListener('click', async () => {
  const label = draftedLabels[Number(($('refinePick') as HTMLSelectElement).value)] ?? '';
  const instruction = ($('refineInstruction') as HTMLTextAreaElement).value.trim();
  const status = $('refineStatus');
  if (!instruction) {
    status.textContent = 'Add an instruction first.';
    return;
  }
  const btn = $('refineGo') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Redoing…';
  const r = await rpc<{
    ok: boolean;
    usage?: { promptTokens: number; completionTokens: number } | null;
    error?: string;
  }>('redraft', { label, instruction });
  btn.disabled = false;
  btn.textContent = 'Redo this answer';
  if (r?.ok) {
    if (r.usage) await recordDraft(1, r.usage.promptTokens, r.usage.completionTokens);
    status.innerHTML = '<span class="chip ok">✓ Rewritten — check it on the page</span>';
    await renderAiUsage();
  } else status.innerHTML = `<span class="chip rev">${esc(r?.error ?? 'Could not refine')}</span>`;
});
($('save') as HTMLButtonElement).addEventListener('click', async (e) => {
  const b = e.currentTarget as HTMLButtonElement;
  const label = b.textContent ?? '📌 Save job';
  b.disabled = true;
  b.textContent = 'Saving…';
  const r = await rpc<{ ok: boolean; error?: string } | null>('save');
  if (r?.ok) showMiniResult(true, 'Saved to your JobHakken app.');
  else showMiniResult(false, friendlyError(r?.error, 'Could not save this job.'));
  b.textContent = label;
  b.disabled = false;
});
($('capture') as HTMLButtonElement).addEventListener('click', async (e) => {
  const b = e.currentTarget as HTMLButtonElement;
  b.textContent = 'Capturing…';
  const r = await rpc<{ total: number; resolved: number; unresolved: number } | null>('capture');
  b.textContent = '📸 Capture fixture (dev)';
  $('captureResult').textContent = r
    ? `Saved fixture + coverage · resolved ${r.resolved}/${r.total}${r.unresolved ? ` · ${r.unresolved} to teach` : ''}`
    : 'Capture failed.';
});
($('siteCap') as HTMLInputElement).addEventListener(
  'change',
  (e) => void rpc('toggleSite', { on: (e.currentTarget as HTMLInputElement).checked }).then(render),
);

// ── feedback → prefilled GitHub issue (no backend needed) ──
// Auto-fills the page + environment diagnostics a maintainer would otherwise have to ask for: URL, ATS
// platform, field count, the last autofill result, mode, browser/OS, extension version, AI provider.
// Deliberately EXCLUDES personal data — no profile values, résumé text, or drafted answers.
const REASONS: Record<string, string> = {
  'not-detected': 'Not detected as a job page',
  'autofill-missed': 'Autofill missed fields',
  'wrong-sponsorship': 'Wrong sponsorship flag',
  other: 'Something else',
};
function reportHost(): string {
  try {
    return lastState?.job?.url
      ? new URL(lastState.job.url).hostname.replace(/^www\./, '')
      : (lastState?.job?.company ?? 'unknown');
  } catch {
    return lastState?.job?.company ?? 'unknown';
  }
}
async function openReport(reasonKey: string) {
  const reason = REASONS[reasonKey] ?? 'Feedback';
  const s = lastState;
  const host = reportHost();
  const version = chrome.runtime.getManifest().version;
  const title = s?.job?.title || '(unknown)';
  const company = s?.job?.company || '(unknown)';
  const pageUrl = s?.job?.url || '(unknown)'; // a job posting URL is public, not personal data
  const elig = s?.eligibility?.blocked ? `⚠️ won't sponsor — ${s.eligibility.categories.join(', ')}` : 'none';
  const h1b = s?.h1b && s.h1b.approvals > 0 ? `✅ ${s.h1b.company} · ${s.h1b.approvals} approvals` : 'none';
  // Environment + last-run diagnostics: everything a maintainer would otherwise have to ask for.
  const ats = s?.atsPlatform ?? '(not detected)';
  const chrome_ = / Chrome\/(\d+)/.exec(navigator.userAgent)?.[1];
  const os = /Mac/.test(navigator.userAgent)
    ? 'macOS'
    : /Windows/.test(navigator.userAgent)
      ? 'Windows'
      : /Linux|X11|CrOS/.test(navigator.userAgent)
        ? 'Linux/ChromeOS'
        : 'other';
  const fill = lastFill
    ? `${lastFill.filled}/${lastFill.total} filled${lastFill.review ? ` · ${lastFill.review} to review` : ''}${lastFill.partial ? ' · partial (slow/cancelled)' : ''}`
    : '(autofill not run in this popup session)';
  const ai = await getAiConfigMeta().catch(() => null);
  const aiLine = ai?.hasKey ? `${ai.provider || 'openrouter'}${ai.model ? ` · ${ai.model}` : ''}` : 'no key set';
  if (reasonKey === 'not-detected') await rpc('toggleSite', { on: true }); // also make it work next time
  const body = [
    `### ⚑ ${reason}`,
    '',
    '**What went wrong / what did you expect?**',
    '_(describe here — screenshots welcome)_',
    '',
    '### Page',
    `| | |`,
    `|---|---|`,
    `| **URL** | ${pageUrl} |`,
    `| **Job** | ${title} — ${company} |`,
    `| **ATS platform** | \`${ats}\` |`,
    `| **Detected** | ${s?.relevant ? 'yes' : 'no'} · ${s?.fields ?? 0} fillable fields |`,
    `| **Last autofill** | ${fill} |`,
    `| **Sponsorship flag** | ${elig} |`,
    `| **H‑1B sponsor** | ${h1b} |`,
    '',
    '### Environment',
    `| | |`,
    `|---|---|`,
    `| **Extension** | v${version} |`,
    `| **Browser / OS** | Chrome ${chrome_ ?? '?'} · ${os} |`,
    `| **Mode** | ${s?.mode ?? 'unknown'}${s?.testMode ? ' · demo mode' : ''} |`,
    `| **AI provider** | ${aiLine} |`,
    '',
    '### Steps to reproduce',
    '1. ',
    '2. ',
    '',
    '---',
    `_JobHakken extension v${version} · auto-filled from the page. No personal data included (no profile values, résumé, or answers)._`,
  ].join('\n');
  // GitHub offers "this looks like a duplicate" purely on title similarity, and the title used to be
  // just reason + company — so a second report about a different posting on the same site was
  // byte-identical to the first and got flagged, which reads as "we already know" when we do not.
  //
  // Appending the ATS platform and a short ref derived from the page makes each posting distinct. The
  // ref is DETERMINISTIC on origin + path (query stripped, since LinkedIn and Greenhouse both hang
  // tracking ids off their URLs and those would make one posting look like several). So reporting the
  // SAME page twice still collides — which is a real duplicate and should look like one — while two
  // different postings never do.
  const pageRef = (u: string): string => {
    let clean = u;
    try {
      const parsed = new URL(u);
      clean = parsed.origin + parsed.pathname;
    } catch {
      /* not a parseable URL — hash whatever we were given */
    }
    let h = 0;
    for (let i = 0; i < clean.length; i++) h = (Math.imul(31, h) + clean.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36).slice(0, 5);
  };
  const where = company !== '(unknown)' ? company : host;
  const platform = ats && ats !== 'unknown' && ats !== '(none)' ? ` · ${ats}` : '';
  const issueTitle = `[extension] ${reason} — ${where}${platform} [${pageRef(pageUrl)}]`;
  const url = `${REPO}/issues/new?labels=${encodeURIComponent('extension-feedback')}&title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(body)}`;
  await chrome.tabs.create({ url });
  window.close();
}
document
  .querySelectorAll<HTMLElement>('.rbody button')
  .forEach((b) => b.addEventListener('click', () => void openReport(b.dataset.r ?? 'other')));

void render();
void renderAiUsage();
