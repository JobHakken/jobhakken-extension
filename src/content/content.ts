import {
  autofillForm,
  autofillInteractive,
  captureCoverage,
  cleanClone,
  deriveFullProfile,
  detectFileInputs,
  detectFields,
  expandRepeatingSections,
  isAtsPage,
  learnableAnswers,
  readLazyOptions,
  resolveField,
  setInputFile,
  unmappedQuestions,
  type CoverageReport,
  type FullProfile,
  type MappingStore,
  type Profile,
} from '@jobhakken/autofill';

import { loadAnswerStore } from '../lib/answerStore.js';
import { type BridgeConnection } from '../lib/bridgeClient.js';
import { bucket, report } from '../lib/telemetryClient.js';
import { isAtsHost, isCaptureAllowed, setSiteOptIn, upsertCapture, type CaptureField } from '../lib/captureStore.js';
import { buildCandidateContext } from '../lib/aiClient.js';
import { loadConnection } from '../lib/connectionStore.js';
import {
  loadAutoCapture,
  loadCaptureMode,
  loadFillSensitive,
  loadFullProfile,
  loadHideUnsponsored,
  loadNeedsSponsorship,
  loadTestMode,
} from '../lib/profileStore.js';
import { textToPdfFile } from '../lib/pdf.js';
import { dummyCoverLetterFile, dummyResumeFile } from '../lib/testFiles.js';
import { TEST_PROFILE } from '../lib/testProfile.js';
import { applyEligibilityFilter, getEligibilityVerdict } from './eligibility.js';
import { applyH1bBadges, getH1bVerdict } from './h1b.js';

/**
 * Content script (Phase 7.2/7.3): injects the docked panel, keeps the toolbar badge
 * in sync, and autofills the page. Works **standalone** (local profile, no desktop)
 * for autofill; the AI actions use the desktop bridge when connected.
 */

let connection: BridgeConnection | null = null;
let hasLocalProfile = false;
let testMode = false;
let appTest = false;
let bridgeLive = false; // is the desktop app actually reachable right now (live health)?
let captureMode = false;
let autoCaptureOn = false; // opt-in (default OFF) — see loadAutoCapture / Options consent
let siteOptedIn = false;
let needsSponsorship = false; // "I need visa sponsorship" → mark/hide roles that won't sponsor
let hideUnsponsored = false; // hide (vs mark) won't-sponsor tiles
let fieldCount = 0;
let autofillAbort: AbortController | null = null; // lets the popup cancel a running autofill
// What autofill wrote, kept in the isolated world (NOT page-readable data-* attrs) so a later capture
// can distinguish autofill from manual entry without leaking the values to the page (#12).
const filledValues = new WeakMap<Element, string>();

// Visually flag the fields the user should review (filled at review-confidence, or AI-drafted) so
// "N to review" is actionable — an amber outline + hover hint, cleared on the next fill. Tracking
// lives in the isolated world (a WeakSet + array), never a page-readable value (#12); only the
// outline/title are visible, which is the point.
const REVIEW_HINT = 'JobHakken filled this — please review before submitting';
const REVIEW_COLOR = '#7c3aed'; // vivid violet — stands out, and unlike red/blue isn't confused with a
// validation error or a focus ring
const reviewMarked = new WeakSet<HTMLElement>();
let reviewedEls: HTMLElement[] = [];
/** The most-visible box to outline — the control itself, or (for a styled/hidden radio) its label. */
function reviewTarget(el: HTMLElement): HTMLElement {
  if (el.offsetWidth > 0 && el.offsetHeight > 0) return el;
  const scope = el.getRootNode() as ParentNode;
  const forLabel = el.id
    ? (Array.from(scope.querySelectorAll('label')).find((l) => (l as HTMLLabelElement).htmlFor === el.id) as
        HTMLElement | undefined)
    : undefined;
  const box =
    (el.closest('label') as HTMLElement | null) ??
    forLabel ??
    (el.closest('[class*="question"],[class*="field"],fieldset,li') as HTMLElement | null) ??
    el.parentElement ??
    el;
  return box.offsetWidth > 0 ? box : el;
}
function clearReviewMarks(): void {
  for (const el of reviewedEls) {
    el.style.outline = '';
    el.style.outlineOffset = '';
    el.style.boxShadow = '';
    el.style.borderRadius = '';
    if (el.getAttribute('title') === REVIEW_HINT) el.removeAttribute('title');
    reviewMarked.delete(el);
  }
  reviewedEls = [];
}
function markReview(el: HTMLElement): void {
  const t = reviewTarget(el);
  if (reviewMarked.has(t)) return;
  t.style.outline = `2.5px solid ${REVIEW_COLOR}`;
  t.style.outlineOffset = '2px';
  t.style.boxShadow = '0 0 0 4px rgba(124, 58, 237, 0.22)'; // soft violet glow for extra visibility
  t.style.borderRadius = t.style.borderRadius || '4px';
  if (!t.getAttribute('title')) t.setAttribute('title', REVIEW_HINT);
  reviewMarked.add(t);
  reviewedEls.push(t);
}

/**
 * Reveal a form hidden behind a pre-step — but ONLY when the step commits nothing and we can satisfy
 * it from a KNOWN fact (never auto-consenting or guessing for the user). Jobvite hides its application
 * behind a "Location of Residence and Language" <select name=jv-country-select>; choosing the user's
 * OWN residence just renders the form (the actual privacy consent is at submit, which we never do), so
 * advance it only when the profile country clearly matches an option, else leave it for the user.
 */
async function advanceKnownGates(country: string | undefined): Promise<void> {
  const sel = document.querySelector<HTMLSelectElement>('select#jv-country-select, select[name="jv-country-select"]');
  if (!sel || sel.selectedIndex > 0 || !country) return;
  const c = country.toLowerCase();
  const wantUS = /united states|u\.?s\.?a?|america/.test(c);
  const wantUK = /united kingdom|u\.?k\.?|britain|england/.test(c);
  let idx = -1;
  for (let i = 1; i < sel.options.length; i++) {
    const t = sel.options[i].text.toLowerCase();
    if (t.includes(c) || (wantUS && /\bus\b|united states/.test(t)) || (wantUK && /\buk\b|united kingdom/.test(t))) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return; // no confident match → don't choose a residence/policy on the user's behalf
  const before = document.querySelectorAll('input:not([type=hidden]),select,textarea').length;
  sel.selectedIndex = idx;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  // Wait for the revealed form to actually render (SPA) before the caller detects + fills — poll up to
  // ~5s rather than a fixed guess, else a single Autofill click advances the gate but fills nothing.
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    if (document.querySelectorAll('input:not([type=hidden]),select,textarea').length > before) break;
  }
  await sleep(700); // small settle so the revealed inputs are hydrated before the caller fills them
}

// Answer bank: learned field→key mappings + remembered answers to unmapped questions, persisted
// locally so autofill improves with use. One store instance per page, reused by autofill + capture.
let answerStoreP: Promise<MappingStore> | null = null;
const answerStore = () => (answerStoreP ??= loadAnswerStore());

/** Remember answers the user typed into questions the profile couldn't fill (auto-capture). */
function captureLearnable(fp: FullProfile, store: MappingStore): void {
  try {
    for (const a of learnableAnswers(document, { profile: fp.profile, userRules: fp.rules, store })) {
      // reuse-at-review confidence; a user rule/profile value always outranks it
      store.put(a.signature, { value: a.value, source: 'user', confidence: 0.7 });
    }
  } catch {
    /* capture is best-effort; never block the page */
  }
}

// Live auto-capture: when the user edits a field, remember answers to unmapped questions so the
// SAME/similar question autofills next time. Debounced; skips our own fills (they resolve → excluded).
let captureTimer: ReturnType<typeof setTimeout> | undefined;
document.addEventListener(
  'change',
  () => {
    clearTimeout(captureTimer);
    captureTimer = setTimeout(async () => {
      const fp = await getFullProfile();
      if (fp) captureLearnable(fp, await answerStore());
    }, 1200);
  },
  true,
);

/**
 * "connected" requires the bridge to be LIVE, not just cached credentials — so closing the
 * app flips the panel to standalone (and reopening it reconnects on the next poll). Cached
 * connection creds still allow standalone autofill from the last-known profile.
 */
function mode(): 'connected' | 'standalone' | 'none' {
  if (connection && bridgeLive) return 'connected';
  return connection || hasLocalProfile ? 'standalone' : 'none';
}

/**
 * Live bridge check: ping the app's status over the SW proxy. Updates bridgeLive (real
 * reachability) + appTest (its sandbox state). Distinguishes "app closed" from "not test
 * mode" — a bare appTestMode() couldn't.
 */
async function checkBridge(): Promise<void> {
  if (!connection) {
    bridgeLive = false;
    appTest = false;
    return;
  }
  try {
    const s = await bridgeRpc<{ testMode?: boolean }>('status');
    bridgeLive = true;
    appTest = !!s?.testMode;
  } catch {
    bridgeLive = false; // app closed / bridge disabled
    appTest = false;
  }
}

/**
 * Call a desktop-bridge RPC via the background service worker. The SW fetches 127.0.0.1
 * from the extension origin (host_permissions) — so the page never triggers the browser's
 * per-site "access local device" prompt that a content-script fetch would.
 */
async function bridgeRpc<T>(method: string, params: unknown = {}): Promise<T> {
  const res = (await chrome.runtime.sendMessage({ type: 'f2a-bridge', method, params })) as
    { result?: T; error?: string } | undefined;
  if (!res || res.error) throw new Error(res?.error || 'bridge error');
  return res.result as T;
}

/** Is the connected desktop app running in its test-data sandbox? (keeps modes in sync) */
async function appTestMode(): Promise<boolean> {
  if (!connection) return false;
  try {
    const s = await bridgeRpc<{ testMode?: boolean }>('status');
    return !!s?.testMode;
  } catch {
    return false;
  }
}

/**
 * Test mode is active when EITHER the extension toggle or the connected app is in its
 * sandbox. The single source of truth for "use anonymous dummy data, never real" — used
 * for the profile AND documents, so no real personal data (name, résumé) is ever used.
 * (Job/insights still use the real connection — jobs carry no personal data.)
 */
async function isTestActive(): Promise<boolean> {
  return (await loadTestMode()) || (await appTestMode());
}

/**
 * The profile to fill from. TEST MODE → the built-in anonymous TEST_PROFILE, so nothing
 * real is exposed. Otherwise prefer the desktop's résumé-derived profile, else local.
 */
async function getFullProfile(): Promise<FullProfile | null> {
  if (await isTestActive()) return TEST_PROFILE;
  const p = connection?.profile as Parameters<typeof deriveFullProfile>[0] | undefined;
  if (p?.basics) return deriveFullProfile(p);
  return await loadFullProfile();
}

let appLike = false; // page looks like a JOB application (résumé upload, or an EEO/screening field)

// Job-application-specific fields — these appear on real applications but NOT on ordinary
// account/profile/settings pages (which have name/email/company but none of these). Using
// them (instead of a raw "≥3 profile fields" count) stops the panel flashing on e.g. a
// GitHub profile-settings page.
const APPLICATION_KEYS = new Set([
  'workAuthorization',
  'requiresSponsorship',
  'coverLetter',
  'salaryExpectation',
  'veteranStatus',
  'disabilityStatus',
  'hispanicLatino',
  'raceEthnicity',
  'howHeard',
]);

/**
 * The panel opens ONLY on job-application pages, never on ordinary sites (google.com,
 * a GitHub settings page, etc.). A page qualifies if:
 *   • it's a known ATS host (Workday/Greenhouse/Lever/…), OR
 *   • it's fingerprinted as an ATS (company career site running one under the hood), OR
 *   • the user opted this site in, OR
 *   • it has a real job-application signal — a résumé/CV upload, or an EEO/screening field
 *     (work authorization, sponsorship, cover letter, salary, veteran/disability, …).
 */
function isRelevantPage(): boolean {
  return isAtsHost(location.hostname) || isAtsPage(document) || siteOptedIn || appLike;
}

/**
 * Inject the eligibility + H-1B badges. Reads the (untrusted) page DOM, so it must NEVER throw out to
 * callers — a hostile/odd DOM must not abort init() (which wires the RPC handler) or the mutation loop.
 */
function applyBadges(): void {
  try {
    applyEligibilityFilter(needsSponsorship, hideUnsponsored);
    void applyH1bBadges(needsSponsorship);
  } catch {
    /* hostile/odd page DOM — skip badges, keep the rest of the extension working */
  }
}

function updateBadge(): void {
  const fields = detectFields(document);
  fieldCount = fields.length;
  const hasResume = detectFileInputs(document).some((f) => f.kind === 'resume');
  const hasAppSignal = fields.some((f) => {
    const key = resolveField(f)?.key;
    return key ? APPLICATION_KEYS.has(key) : false;
  });
  appLike = hasResume || hasAppSignal;
  const relevant = isRelevantPage();
  // Toolbar icon badge: show the fillable-field count on application pages (the popup is the UI now).
  void chrome.runtime.sendMessage({ type: 'f2a-detected', count: relevant ? fieldCount : 0 }).catch(() => {});
}

/** Real company for the opened job. LinkedIn (and many boards) title as "Title | Company | Site",
 *  so the middle segment is the company — far better than the hostname ("linkedin"). */
function pageCompany(): string {
  const parts = document.title
    .split(/\s[|·—–]\s/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 2]; // …| Company | LinkedIn
  return location.hostname.replace(/^www\./, '').split('.')[0];
}

/** Snapshot of everything the toolbar popup renders. Queried fresh each time the popup opens. */
function getState() {
  const verdict = getEligibilityVerdict();
  return {
    mode: mode(),
    fields: fieldCount,
    relevant: isRelevantPage(),
    job: { title: cleanTitle(document.title), company: pageCompany(), url: location.href },
    testMode: testMode || appTest,
    captureMode,
    captureSite: { show: !isAtsHost(location.hostname), optedIn: siteOptedIn },
    eligibility:
      verdict && verdict.blocked
        ? { blocked: true, categories: Array.from(new Set(verdict.reasons.map((r) => r.category))) }
        : null,
    h1b: getH1bVerdict(),
  };
}

/** Race a promise against a timeout + optional abort signal — so autofill never hangs the UI. */
function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function runAutofill(
  mode: 'default' | 'ats' = 'default',
  signal?: AbortSignal,
): Promise<{ filled: number; review: number; total: number; partial?: boolean } | null> {
  const fp = await getFullProfile();
  if (!fp || Object.keys(fp.profile).length === 0) return null;
  await advanceKnownGates(fp.profile.country); // reveal a form hidden behind a known-fact pre-step
  const fillSensitive = await loadFillSensitive();
  const store = await answerStore();
  // learn any answers the user typed into unmapped questions since last time, then reuse them below
  captureLearnable(fp, store);
  const common = {
    profile: fp.profile,
    experience: fp.experience,
    education: fp.education,
    userRules: fp.rules,
    fillSensitive,
    store,
  };
  // 1) grow repeated sections so there's a row per role/school ("Add another")
  await expandRepeatingSections(document, { experience: fp.experience?.length, education: fp.education?.length });
  // 2) synchronous fill (text/select/radio + multi-row groups) — fast, always completes.
  // NB: fill runs against the whole document — scoping to formRegion() was tried (#13) but broke
  // Workday, whose fields span wider than the detected-field common ancestor. The engine gates the
  // actual field mapping, so this isn't a mis-fill in practice.
  const report = autofillForm({ root: document, ...common });
  // Remember what WE filled — in an isolated-world WeakMap, NOT page-readable data-* attributes (#12) —
  // so a later capture can tell autofill from manual entry without exposing the values to the page.
  clearReviewMarks(); // fresh run → drop last run's outlines
  for (const r of report.results) {
    if (r.field.el instanceof HTMLElement) {
      if (r.status === 'filled') filledValues.set(r.field.el, String(r.value));
      else if (r.status === 'review') markReview(r.field.el); // outline it so the user can find it
    }
  }
  // 3+4) the SLOW part — live widgets (Workday comboboxes/dates) + résumé/cover-letter
  //      upload (ATS mode renders a tailored résumé via the desktop AI, which can be slow).
  //      Bound it so the button never hangs forever, and honor Cancel. On timeout/cancel we
  //      keep the synchronous field fills and report a partial result.
  let extra = 0;
  let partial = false;
  try {
    extra = await withTimeout(
      (async () => {
        const live = await autofillInteractive({ root: document, ...common });
        const uploaded = await uploadDocuments(mode);
        return live.comboboxes + live.dates + uploaded;
      })(),
      mode === 'ats' ? 45_000 : 20_000,
      signal,
    );
  } catch {
    partial = true; // timed out or cancelled — the synchronous fields are still filled
  }
  void captureFlow(); // record the autofilled state into the corpus
  return { filled: report.filled + extra, review: report.review, total: report.total, partial };
}

// ── multi-step wizard orchestration ─────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A string that identifies the current wizard step (heading + path + active-step label), so we can
 * tell when a "Continue" actually advanced us vs. was blocked by validation. */
function stepSignature(): string {
  const heading = document.querySelector('h1,h2,[role="heading"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const active =
    document
      .querySelector(
        '[aria-current="step"], [data-automation-id*="progressBarActive" i], [class*="active" i][class*="step" i]',
      )
      ?.textContent?.trim() ?? '';
  // "step 2 of 6" is the most reliable change signal on wizards whose URL/heading don't change.
  const stepNum = (document.body.innerText || '').match(/step\s+(\d+)\s+of\s+\d+/i)?.[1] ?? '';
  return `${location.pathname}|${heading}|${active}|${stepNum}`.slice(0, 200);
}

/** Is this a multi-step application (a wizard with a step/progress indicator)? Only then do we
 * auto-advance — a single-page form has no "next" to click. */
function isWizardForm(): boolean {
  if (/\bstep\s+\d+\s+of\s+\d+\b/i.test(document.body.innerText || '')) return true;
  if (document.querySelector('[data-automation-id*="progressBar" i]')) return true;
  const steps = document.querySelectorAll(
    '[role="navigation"] [aria-current], nav [class*="step" i], [class*="progress" i] [class*="step" i]',
  );
  return steps.length >= 2;
}

const ADVANCE_RE =
  /^(save and continue|save & continue|save and go to next|save and proceed|next|continue|save and continue to next|next step|save & next|proceed)$/i;
const SUBMIT_RE = /submit|send application|finish|complete application|review your application|apply now/i;

/** The control that ADVANCES to the next step — never a Submit/Send/Finish (those are a hard stop,
 * so we hand off to the user at Review). Returns the clickable element, or null to stop. */
function findAdvanceControl(): HTMLElement | null {
  const cands = Array.from(
    document.querySelectorAll('button, [role="button"], input[type="submit"], a[href="#"]'),
  ) as HTMLElement[];
  for (const el of cands) {
    if (isComputedHiddenLike(el) || (el as HTMLButtonElement).disabled) continue;
    const name = (el.textContent || el.getAttribute('aria-label') || (el as HTMLInputElement).value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || SUBMIT_RE.test(name) || /\b(back|previous|cancel|save as draft|save draft|autofill)\b/i.test(name))
      continue;
    if (ADVANCE_RE.test(name)) return el;
  }
  return null; // no advance control (single-page, or the only forward action is Submit → stop)
}

/** cheap visibility check (avoids importing the engine's internal one) */
function isComputedHiddenLike(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) <= 0.01) return true;
  const r = el.getBoundingClientRect();
  return r.width < 2 && r.height < 2;
}

/**
 * Fill an ENTIRE application in one click: fill the current step, click Continue (never Submit),
 * wait for the next step, repeat — until Review / a Submit-only step / a validation stall / the cap.
 * A single-page form just fills once (no advance control). The user always reviews + submits.
 */
async function autofillWholeApplication(
  mode: 'default' | 'ats',
  signal?: AbortSignal,
): Promise<{ filled: number; review: number; total: number; partial?: boolean; steps: number; stopped: string }> {
  let filled = 0;
  let review = 0;
  let total = 0;
  let steps = 0;
  let stopped = 'done';
  for (let i = 0; i < 12; i++) {
    if (signal?.aborted) {
      stopped = 'cancelled';
      break;
    }
    // Two re-detecting passes per step: a step can have more lazy comboboxes than one interactive
    // budget reaches, and framework re-renders (Taleo JSF partial postbacks, BrassRing/Oracle
    // Angular/Knockout) mutate the DOM mid-fill — which can THROW on stale element refs. Each pass
    // re-detects (runAutofill calls detectFields fresh) and refills; wrapping each pass so a mid-fill
    // re-render never aborts the whole run means the 2nd pass simply re-detects and completes.
    let r: Awaited<ReturnType<typeof runAutofill>> = null;
    for (let pass = 0; pass < 2; pass++) {
      if (signal?.aborted) break;
      try {
        r = await runAutofill(mode, signal);
      } catch {
        await sleep(400); // DOM re-rendered mid-pass — let it settle; the next pass re-detects
      }
    }
    if (r) {
      filled += r.filled;
      review += r.review;
      total += r.total;
    }
    steps++;
    if (!isWizardForm()) {
      stopped = 'single-page';
      break;
    }
    const sig = stepSignature();
    const adv = findAdvanceControl();
    if (!adv) {
      stopped = 'reached-review-or-submit';
      break;
    } // hand to the user to review + submit
    // Let the just-filled async widgets (Workday multiselect prompts, comboboxes) settle their
    // validation state before advancing — clicking Save-and-Continue too early makes Workday
    // validate against not-yet-committed values and refuse to move.
    await sleep(600);
    // wait for the step to actually change; if it doesn't, RE-CLICK once (the first click can race a
    // still-open prompt / pending validation), then keep waiting before declaring a real stall.
    let changed = false;
    adv.click();
    for (let w = 0; w < 30 && !changed; w++) {
      await sleep(300);
      changed = stepSignature() !== sig;
      if (!changed && w === 10) findAdvanceControl()?.click(); // one retry after ~3s
    }
    if (!changed) {
      stopped = 'validation-stall';
      break;
    }
  }
  return { filled, review, total, steps, stopped };
}

/**
 * Attach the résumé / cover letter to the page's file inputs. Test mode uses bundled
 * dummy PDFs; otherwise the connected desktop app's résumé — the default one, or (ATS
 * mode) one tailored to this job. Only résumé/cover-letter inputs are touched.
 */
async function uploadDocuments(mode: 'default' | 'ats' = 'default'): Promise<number> {
  const inputs = detectFileInputs(document).filter((f) => f.kind === 'resume' || f.kind === 'coverLetter');
  if (!inputs.length) return 0;
  // test mode (extension toggle OR connected app sandbox) → dummy docs; never the real résumé
  const files: { resume?: File; coverLetter?: File } = (await isTestActive())
    ? { resume: dummyResumeFile(), coverLetter: dummyCoverLetterFile() }
    : await realDocuments(mode);
  let n = 0;
  for (const f of inputs) {
    const file = f.kind === 'coverLetter' ? files.coverLetter : files.resume;
    if (file && setInputFile(f.el, file)) n++;
  }
  return n;
}

/** Decode base64 → a File (for the résumé PDF the desktop app renders). */
function base64ToFile(base64: string, name: string, type: string): File {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type });
}

/**
 * Real documents to attach: the latest saved résumé (rendered to PDF by the connected
 * desktop app) and the user's default cover letter (their saved text → PDF, client-side,
 * no AI needed).
 */
async function realDocuments(mode: 'default' | 'ats' = 'default'): Promise<{ resume?: File; coverLetter?: File }> {
  const out: { resume?: File; coverLetter?: File } = {};
  if (connection) {
    try {
      const method = mode === 'ats' ? 'tailoredResumeFile' : 'resumeFile';
      const r = await bridgeRpc<{ fileName?: string; base64?: string; mimeType?: string }>(
        method,
        mode === 'ats' ? pageJob() : {},
      );
      if (r?.base64) out.resume = base64ToFile(r.base64, r.fileName || 'resume.pdf', r.mimeType || 'application/pdf');
    } catch {
      /* no résumé saved, or rendering unavailable — skip résumé */
    }
  }
  // default cover letter comes from the user's saved profile text (local), rendered here
  const local = await loadFullProfile();
  const coverText = local?.profile.coverLetter?.trim();
  if (coverText) out.coverLetter = textToPdfFile(coverText, 'cover-letter.pdf', 'Cover Letter');
  return out;
}

function triggerDownload(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Capture the current page as a clean, PII-free fixture + a coverage report (what the
 * generic engine resolved vs. couldn't). Site-agnostic. Opens each combobox first so the
 * saved fixture includes the real options. Downloads two files and returns a summary.
 */
async function capturePage(): Promise<{
  total: number;
  resolved: number;
  unresolved: number;
  unresolvedLabels: string[];
} | null> {
  try {
    // open every lazy combobox so its options render into the DOM we serialize
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>('[role="combobox"], [aria-haspopup="listbox"]'),
    )) {
      await readLazyOptions(el, 400);
    }
    const report: CoverageReport = captureCoverage(document, { url: location.href });
    // scrub the fill profile's values (bridge when connected, else local) from the saved
    // HTML (belt-and-suspenders; in test mode the page holds only dummy data anyway)
    const scrub = await scrubValues();
    const html = cleanClone(document.documentElement, scrub);
    const host = location.hostname.replace(/^www\./, '').split('.')[0] || 'page';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    triggerDownload(`${host}-${stamp}.html`, html, 'text/html');
    triggerDownload(`${host}-${stamp}.coverage.json`, JSON.stringify(report, null, 2), 'application/json');
    return {
      total: report.total,
      resolved: report.resolved,
      unresolved: report.unresolved,
      unresolvedLabels: report.unresolvedLabels,
    };
  } catch (e) {
    void e;
    return null;
  }
}

/** Smallest region containing the application's fields (keeps captures small). */
function formRegion(): Element {
  const els = detectFields(document)
    .map((f) => f.el)
    .filter((e) => e instanceof HTMLElement && !e.closest('nav, header, footer'));
  if (!els.length) return document.body;
  let anc: Element | null = els[0];
  for (const el of els.slice(1)) while (anc && !anc.contains(el)) anc = anc.parentElement;
  return (anc?.closest('form, main, section') as Element | null) ?? anc ?? document.body;
}

/** Current value of a detected field (text/select/textarea, radio group, or combobox). */
function fieldCurrentValue(f: ReturnType<typeof detectFields>[number]): string {
  const el = f.el as HTMLElement;
  if (f.kind === 'radio') {
    const checked = f.name
      ? document.querySelector<HTMLInputElement>(`input[name="${CSS.escape(f.name)}"]:checked`)
      : null;
    return checked ? checked.labels?.[0]?.textContent?.trim() || checked.value || 'on' : '';
  }
  if (f.kind === 'combobox') return (el.getAttribute('data-f2a-value') || el.textContent || '').trim();
  const v = (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  if (f.kind === 'select') {
    const sel = el as HTMLSelectElement;
    return sel.selectedOptions?.[0]?.textContent?.trim() || v || '';
  }
  return (v ?? '').trim();
}

/** Escape a literal string for use inside a RegExp. */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * PII strings to redact from captured HTML/field values. Sourced from the profile we
 * ACTUALLY fill from — the connected desktop's bridge profile when connected, else the
 * local profile — plus the local profile, and expanded with name tokens so a first/last
 * name shows redacted even when a field holds only one part of it. Address/city/zip are
 * whole profile values and are covered directly. (Test mode fills dummy data — nothing
 * real to add.)
 */
async function scrubValues(): Promise<string[]> {
  const local = await loadFullProfile();
  const bridge = connection?.profile as Parameters<typeof deriveFullProfile>[0] | undefined;
  const profiles: Array<Profile | undefined> = [
    local?.profile,
    bridge?.basics ? deriveFullProfile(bridge).profile : undefined,
  ];
  const set = new Set<string>();
  for (const p of profiles) {
    if (!p) continue;
    for (const v of Object.values(p)) if (typeof v === 'string' && v.trim()) set.add(v.trim());
    // name tokens: a field may hold just "Jordan" while the profile has "Jordan Rivera"
    for (const key of ['fullName', 'firstName', 'middleName', 'lastName', 'preferredName'] as const) {
      const nm = p[key];
      if (typeof nm === 'string') for (const tok of nm.split(/\s+/)) if (tok.trim().length >= 3) set.add(tok.trim());
    }
  }
  return [...set].filter((s) => s.length >= 3);
}

/** Make a field value safe to store: scrub known PII, reduce emails/phones/long text to shapes. */
function safeValue(raw: string, scrub: string[]): string {
  if (!raw) return '';
  let v = raw;
  // Redact embedded PII as SUBSTRINGS (not just whole-string), so PII inside a free-text answer
  // ("call John at 555-867-5309", "DOB 01/15/1990") is caught too (#11).
  v = v.replace(/[^@\s]+@[^@\s]+\.[a-z]{2,}/gi, '[email]');
  v = v.replace(/\+?\d[\d\-.\s()]{5,}\d/g, '[phone]');
  v = v.replace(/\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g, '[date]');
  for (const s of scrub) if (s && s.length >= 3) v = v.replace(new RegExp(reEscape(s), 'gi'), '[redacted]');
  // Multi-word free text can still carry third-party PII (references, "referred by …") we can't
  // enumerate → keep only its shape. Single-token answers ("Yes", "LinkedIn", "USA") are kept.
  if (v.trim().split(/\s+/).length >= 3 || v.length > 60) return `[text ${v.length} chars]`;
  return v;
}

/**
 * Capture the application FLOW into the local corpus: for each field, whether it was filled
 * by autofill, filled manually by the person, or left empty, plus a PII-safe value. Called
 * on page-settle and (debounced) as the user fills, upserting one evolving record per URL —
 * so the manually-filled fields (the autofill gaps) are captured on real applications.
 * Passive: never opens dropdowns or touches the form. Anonymized at source; local only.
 */
async function captureFlow(): Promise<void> {
  try {
    if (!(await loadAutoCapture())) return;
    if (!isAtsPage(document) && !(await isCaptureAllowed(location.hostname))) return;
    const detected = detectFields(document);
    if (detected.length < 4) return; // only real application forms
    const report = captureCoverage(document, { url: location.href });
    const scrub = await scrubValues();

    let filledByAutofill = 0;
    let filledManually = 0;
    const fields: CaptureField[] = detected.map((f) => {
      const el = f.el as HTMLElement;
      const val = fieldCurrentValue(f);
      // We filled it iff the current value still equals what we wrote (WeakMap, not page-readable) —
      // if the user edited it, they differ → manual (#12).
      const tagged = filledValues.get(el) === val;
      const filledBy: CaptureField['filledBy'] = !val ? 'empty' : tagged ? 'autofill' : 'manual';
      if (filledBy === 'autofill') filledByAutofill++;
      else if (filledBy === 'manual') filledManually++;
      return {
        label: f.label,
        key: resolveField(f)?.key,
        kind: f.kind,
        filledBy,
        value: filledBy === 'empty' ? undefined : safeValue(val, scrub),
      };
    });

    await upsertCapture({
      ts: new Date().toISOString(),
      url: location.href,
      host: location.hostname.replace(/^www\./, ''),
      total: report.total,
      resolved: report.resolved,
      unresolved: report.unresolved,
      unresolvedLabels: report.unresolvedLabels,
      filledByAutofill,
      filledManually,
      fields,
      html: cleanClone(formRegion(), scrub),
    });
  } catch {
    /* capture is best-effort; never disrupt the page */
  }
}

/** A tidy job title from the page <title> (strip trailing " - Company" / site noise). */
function cleanTitle(t: string): string {
  return t
    .split(/\s[|·—–-]\s/)[0]
    .trim()
    .slice(0, 80);
}

/** Best-effort "this job" from the page for the AI actions (rough JD extraction). */
function pageJob() {
  return {
    title: document.title.slice(0, 200),
    // Real employer from the page title (falls back to hostname) — the hostname alone made the
    // visa-sponsor lookup query "linkedin" instead of the actual company.
    company: pageCompany(),
    description: (document.body?.innerText ?? '').slice(0, 8000),
  };
}

type Keyword = { keyword?: string; canonical?: string; status?: string };
async function analyzeJob(): Promise<{
  ats?: number | null;
  visa?: string;
  keywords?: { have: string[]; gap: string[] };
  error?: string;
} | null> {
  if (!connection) return null;
  try {
    const job = pageJob();
    const [kw, visa] = await Promise.all([
      bridgeRpc<{ atsMatchPercent?: number; keywords?: Keyword[] }>('keywords', job).catch(() => null),
      bridgeRpc<{ h1b?: { employer?: string } | null; uk?: { organisation?: string } | null }>('visa', {
        company: job.company,
      }).catch(() => null),
    ]);
    const visaLabel = visa?.h1b ? 'Known H-1B sponsor' : visa?.uk ? 'UK visa sponsor' : undefined;
    const list = kw?.keywords ?? [];
    const keywords = {
      have: list
        .filter((k) => k.status === 'present')
        .map((k) => k.canonical || k.keyword || '')
        .filter(Boolean),
      gap: list
        .filter((k) => k.status === 'missing')
        .map((k) => k.canonical || k.keyword || '')
        .filter(Boolean),
    };
    return { ats: kw?.atsMatchPercent ?? null, visa: visaLabel, keywords };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Analysis failed' };
  }
}

/** Save the currently-open job into the connected desktop app's feed (New column). */
async function saveJob(): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  if (!connection) return { ok: false, error: 'Open the JobHakken app to save jobs' };
  try {
    const r = await bridgeRpc<{ saved?: boolean; already?: boolean }>('saveJob', {
      title: cleanTitle(document.title),
      company: pageCompany(),
      url: location.href,
    });
    return { ok: !!r?.saved, already: r?.already };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to save' };
  }
}

/** Draft an answer for the first empty long-text (screening) field via the desktop AI. */
/** A deterministic placeholder answer for Demo/test mode — no real résumé or LLM involved. */
function draftDummyAnswer(question: string, profile: Profile): string {
  const title = profile.currentTitle || 'software engineer';
  const company = profile.currentCompany ? ` at ${profile.currentCompany}` : '';
  return `As a ${title}${company}, I'm genuinely excited about this opportunity and believe my background is a strong match. [Demo answer for "${question.slice(0, 60)}" — with a résumé connected, JobHakken drafts a tailored response here for you to review.]`;
}

/**
 * AI-fill: draft answers for the custom free-text questions the profile/answer-bank can't cover — the
 * recurring "filled X of Y" gap. Review-first, NEVER auto-submitted. Real answers come from the metered
 * AI proxy over the desktop bridge (per ADR-0003/0009: stateless, content transits per request, never
 * persisted); Demo mode uses a deterministic placeholder so the wiring is testable without a résumé.
 */
type AiUsage = { promptTokens: number; completionTokens: number };

/** BYO-key AI over the SW (the key lives in the SW, never here). Batched: one call for all questions. */
async function aiAnswers(
  context: string,
  job: unknown,
  questions: string[],
): Promise<{ answers?: string[]; usage?: AiUsage | null; error?: string }> {
  const res = (await chrome.runtime.sendMessage({
    type: 'f2a-ai',
    method: 'answers',
    params: { context, job, questions },
  })) as { result?: { answers?: string[]; usage?: AiUsage | null }; error?: string } | undefined;
  if (res?.error) return { error: res.error };
  return { answers: res?.result?.answers ?? [], usage: res?.result?.usage ?? null };
}

async function draftAnswer(): Promise<{ ok: boolean; filled?: number; usage?: AiUsage | null; error?: string } | null> {
  const fp = await getFullProfile();
  if (!fp || Object.keys(fp.profile).length === 0) return { ok: false, error: 'No profile' };
  const test = await isTestActive();
  const store = await answerStore();
  const questions = unmappedQuestions(document, { profile: fp.profile, userRules: fp.rules, store });
  if (!questions.length) return { ok: false, error: 'No question field' };
  const job = pageJob();
  const qs = questions.slice(0, 6); // cap: don't spam a form with many essays

  // Resolution ladder (ADR-0009 §B): Demo stub · BYO key → direct (standalone, no desktop) ·
  // desktop connected → delegate · else prompt to add a key. BYO + delegate never touch each other.
  let answers: string[] = [];
  let usage: AiUsage | null = null;
  if (test) {
    answers = qs.map((q) => draftDummyAnswer(q.label, fp.profile));
  } else {
    const context = buildCandidateContext(
      fp.profile as Record<string, unknown>,
      fp.experience ?? [],
      fp.education ?? [],
    );
    const byo = await aiAnswers(
      context,
      job,
      qs.map((q) => q.label),
    );
    if (byo.answers && byo.answers.length) {
      answers = byo.answers;
      usage = byo.usage ?? null;
    } else if (byo.error === 'no-key') {
      if (!connection) return { ok: false, error: 'Add your AI key in Options, or connect the app' };
      for (const q of qs) {
        try {
          answers.push((await bridgeRpc<{ text?: string }>('answer', { ...job, question: q.label }))?.text ?? '');
        } catch {
          answers.push(''); // one question failing shouldn't block the rest
        }
      }
    } else {
      return { ok: false, error: byo.error || 'AI draft failed' };
    }
  }

  let filled = 0;
  qs.forEach((q, i) => {
    const answer = answers[i];
    if (!answer) return;
    const el = q.el as HTMLInputElement | HTMLTextAreaElement;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, answer);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    markReview(el); // AI drafts always need a look before submitting
    filled++;
  });
  return filled ? { ok: true, filled, usage } : { ok: false, error: 'No draft' };
}

async function init() {
  connection = await loadConnection();
  const local = await loadFullProfile();
  hasLocalProfile = !!local && Object.keys(local.profile ?? {}).length > 0;
  testMode = await loadTestMode();
  await checkBridge(); // live reachability + app sandbox state
  captureMode = await loadCaptureMode();
  autoCaptureOn = await loadAutoCapture();
  needsSponsorship = await loadNeedsSponsorship();
  hideUnsponsored = await loadHideUnsponsored();
  siteOptedIn = !isAtsHost(location.hostname) && (await isCaptureAllowed(location.hostname));

  // Reflect setting changes from the options page without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('f2a_test_mode' in changes) testMode = !!changes['f2a_test_mode'].newValue;
    if ('f2a_capture_mode' in changes) captureMode = !!changes['f2a_capture_mode'].newValue;
    if ('f2a_auto_capture' in changes) autoCaptureOn = !!changes['f2a_auto_capture'].newValue;
    if ('f2a_hide_unsponsored' in changes) hideUnsponsored = !!changes['f2a_hide_unsponsored'].newValue;
    if ('f2a_needs_sponsorship' in changes) {
      needsSponsorship = !!changes['f2a_needs_sponsorship'].newValue;
      applyBadges(); // reflect immediately
    }
  });

  updateBadge(); // toolbar-icon field count
  applyBadges(); // mark/hide won't-sponsor tiles + H-1B sponsor badges

  // Re-detect on SPA/DOM changes (debounced) → refresh badge + eligibility + passive capture.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      updateBadge();
      applyBadges(); // re-run as you switch jobs
      void captureFlow();
    }, 800);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  void captureFlow(); // initial (page may already be settled)

  // Capture the filled FLOW as the person types (debounced) — records manual entries, not
  // just structure, so we learn which fields autofill missed on real applications.
  let fillTimer: ReturnType<typeof setTimeout> | undefined;
  const onUserInput = () => {
    if (fillTimer) clearTimeout(fillTimer);
    fillTimer = setTimeout(() => void captureFlow(), 1500);
  };
  document.addEventListener('input', onUserInput, true);
  document.addEventListener('change', onUserInput, true);

  // Keep the connection status + TEST state LIVE: poll the bridge so closing the app flips to
  // "standalone" and reopening reconnects — and the app's demo mode syncs. The popup reads
  // this fresh via getState (no push-update needed now the floating panel is gone).
  //
  // Throttled to the FOREGROUND: the poll only runs while the tab is visible (and only when
  // there's a connection to check), and is cleared when the tab is hidden — so background
  // tabs (and every extra frame under all_frames) stop hitting 127.0.0.1 every 8s.
  let bridgeTimer: ReturnType<typeof setInterval> | undefined;
  const startBridgePolling = () => {
    if (bridgeTimer || document.hidden || !connection) return;
    bridgeTimer = setInterval(() => void checkBridge(), 8000);
  };
  const stopBridgePolling = () => {
    if (bridgeTimer) {
      clearInterval(bridgeTimer);
      bridgeTimer = undefined;
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopBridgePolling();
    else {
      void checkBridge(); // refresh immediately on return, then resume polling
      startBridgePolling();
    }
  });
  startBridgePolling();

  // ── RPC: the toolbar popup drives everything through the active tab's content script ──
  type Rpc = { type?: string; method?: string; params?: { mode?: 'default' | 'ats'; on?: boolean } };
  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    const msg = raw as Rpc;
    if (msg?.type === 'f2a-run-autofill') {
      void runAutofill(); // legacy one-shot (kept for the popup's quick action)
      return; // no response
    }
    if (msg?.type !== 'f2a-rpc') return;
    (async () => {
      // Always send SOME response: an uncaught throw here (e.g. a page re-render invalidating the
      // context mid-run) would otherwise leave the caller with "message channel closed" instead of a
      // result. Wrap the whole dispatch so the channel always resolves.
      try {
        switch (msg.method) {
          case 'getState':
            sendResponse(getState());
            break;
          case 'autofill': {
            autofillAbort?.abort(); // supersede any in-flight run
            const ctrl = (autofillAbort = new AbortController());
            // one click fills the WHOLE application — advances multi-step wizards (Workday/Oracle/…)
            // step by step, never submitting; single-page forms just fill once.
            const r = await autofillWholeApplication(msg.params?.mode ?? 'default', ctrl.signal);
            report('autofill_run', { ok: !!r && r.filled > 0, fields_filled: bucket(r?.filled ?? 0) });
            sendResponse(r);
            // Only clear if a newer run hasn't superseded us — else we'd wipe ITS controller
            // and break its Cancel.
            if (autofillAbort === ctrl) autofillAbort = null;
            break;
          }
          case 'cancelAutofill':
            autofillAbort?.abort();
            sendResponse({ ok: true });
            break;
          case 'analyze': {
            const res = await analyzeJob();
            report('match_scored', { ok: res?.ats != null });
            sendResponse(res);
            break;
          }
          case 'draft':
            sendResponse(await draftAnswer());
            break;
          case 'scrollToReview': {
            const first = reviewedEls.find((el) => el.isConnected);
            first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            sendResponse({ ok: !!first, count: reviewedEls.filter((el) => el.isConnected).length });
            break;
          }
          case 'save':
            sendResponse(await saveJob());
            break;
          case 'capture':
            sendResponse(await capturePage());
            break;
          case 'toggleSite':
            siteOptedIn = !!msg.params?.on;
            await setSiteOptIn(location.hostname, siteOptedIn);
            if (siteOptedIn) void captureFlow();
            sendResponse({ ok: true });
            break;
          default:
            sendResponse({ error: 'unknown method' });
        }
      } catch (e) {
        try {
          sendResponse({ error: e instanceof Error ? e.message : String(e) });
        } catch {
          /* channel already closed by the caller — nothing to do */
        }
      }
    })();
    return true; // async sendResponse
  });
}

void init();
