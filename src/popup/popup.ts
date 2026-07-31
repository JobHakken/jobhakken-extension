import { hasAiKey } from '../lib/aiKeyStore.js';
import { estCostUsd, fmtCost, fmtTokens, getMonthUsage, recordDraft, totalTokens } from '../lib/aiUsageStore.js';
import { markReviewShown, recordMeaningfulFill, REVIEW_URL, shouldPromptReview } from '../lib/reviewStore.js';
import { loadConnection } from '../lib/connectionStore.js';
import { bestFrameId } from '../lib/frameStore.js';
import { escapeHtml } from '../lib/html.js';
import { loadTestMode } from '../lib/profileStore.js';
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
  try {
    return (await chrome.tabs.sendMessage(
      id,
      { type: 'f2a-rpc', method, params },
      frameId != null ? { frameId } : {},
    )) as T;
  } catch {
    return null;
  }
}

// Use the shared escaper (also escapes ') so all dynamic-HTML sinks share one correct guarantee (#15).
const esc = escapeHtml;

// Public repo so anyone can file feedback (the main jobhakken repo is private → 404 for users).
const REPO = 'https://github.com/JobHakken/JobHakken-issues';
let lastState: State | null = null;

$('ver').textContent = `v${chrome.runtime.getManifest().version}`;
$('gear').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('setupCta').addEventListener('click', () => chrome.runtime.openOptionsPage());
void initThemeToggle($('theme'));

async function render() {
  const [state, conn, testMode] = await Promise.all([rpc<State>('getState'), loadConnection(), loadTestMode()]);
  lastState = state;

  if (!state) {
    $('connLabel').textContent = 'Open a job page';
    $('foot').innerHTML =
      'First time? <b>Set up your profile</b>, then open any job application and click Autofill. JobHakken works on job boards and application pages.';
    // NB: these are real element ids (an earlier list included a phantom "fill2" — a class, not an
    // id — so $('fill2') was null and this whole branch threw before disabling Autofill / showing
    // the CTA; the empty state only looked right thanks to default CSS).
    (['insights', 'mini', 'siteCapRow', 'captureRow'] as const).forEach((id) => $(id).classList.add('hidden'));
    $('setupCta').classList.remove('hidden'); // give first-run / off-a-job-page users a way forward
    $('siteHint').classList.remove('on');
    ($('autofill') as HTMLButtonElement).disabled = true;
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
type FillResult = { filled: number; review: number; total: number; partial?: boolean } | null;
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

  filling = false;
  other.disabled = false;
  big.textContent = prevBig;
  if (sm) sm.textContent = prevSm;
  btn.classList.remove('canceling');

  if (r === '__timeout__') {
    $('fillResult').innerHTML = '<span class="chip rev">Timed out — try again</span>';
    return;
  }
  $('fillResult').innerHTML = r
    ? `<span class="chip ok">✓ ${r.filled} filled</span>${r.review ? `<button class="chip rev jump" title="Scroll to the amber-outlined fields on the page">${r.review} to review →</button>` : ''}${r.partial ? '<span class="chip rev">partial — cancelled/slow</span>' : ''}${r.review ? '<div class="hint">Fields to check are outlined in amber on the page.</div>' : ''}`
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
// Autofill + AI — fill, then draft the open-ended answers in one action.
($('autofillAi') as HTMLButtonElement).addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  await runFill(btn, lastState?.mode === 'connected' ? 'ats' : 'default');
  await doDraft(null); // draft the essays too; shows its own status if there's a key/desktop
});
// Jump to the fields that need review (outlined in amber on the page).
$('fillResult').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.jump')) void rpc('scrollToReview');
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
async function doDraft(btn: HTMLButtonElement | null): Promise<void> {
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
  if (r?.ok) {
    const n = r.filled ?? 1;
    await recordDraft(n, r.usage?.promptTokens ?? 0, r.usage?.completionTokens ?? 0);
    const tok = r.usage ? ` · ~${fmtTokens(totalTokens(r.usage))} tokens` : '';
    showMiniResult(true, `Drafted ${n} answer${n === 1 ? '' : 's'}${tok} — review before submitting.`);
    await renderAiUsage();
  } else if (!(btn === null && /no question/i.test(r?.error ?? ''))) {
    showMiniResult(false, friendlyError(r?.error, 'No open-ended questions to draft here.'));
  }
  if (btn) {
    btn.textContent = label;
    btn.disabled = false;
  }
}
($('draft') as HTMLButtonElement).addEventListener('click', (e) => void doDraft(e.currentTarget as HTMLButtonElement));
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

// ── feedback → prefilled GitHub issue (no backend needed; PII-safe: host only) ──
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
    `| **Detected** | ${s?.relevant ? 'yes' : 'no'} · ${s?.fields ?? 0} fillable fields |`,
    `| **Sponsorship flag** | ${elig} |`,
    `| **H‑1B sponsor** | ${h1b} |`,
    `| **Mode** | ${s?.mode ?? 'unknown'}${s?.testMode ? ' (demo)' : ''} |`,
    '',
    '### Steps to reproduce',
    '1. ',
    '2. ',
    '',
    '---',
    `_JobHakken extension v${version} · auto-filled from the page; no personal data included._`,
  ].join('\n');
  const url = `${REPO}/issues/new?labels=${encodeURIComponent('extension-feedback')}&title=${encodeURIComponent(`[extension] ${reason} — ${company !== '(unknown)' ? company : host}`)}&body=${encodeURIComponent(body)}`;
  await chrome.tabs.create({ url });
  window.close();
}
document
  .querySelectorAll<HTMLElement>('.rbody button')
  .forEach((b) => b.addEventListener('click', () => void openReport(b.dataset.r ?? 'other')));

void render();
void renderAiUsage();
