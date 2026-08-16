import {
  autofillForm,
  autofillInteractive,
  captureCoverage,
  cleanClone,
  deriveFullProfile,
  detectAts,
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
  type ProfileKey,
} from '@jobhakken/autofill';

import { loadAnswerStore } from '../lib/answerStore.js';
import { type BridgeConnection } from '../lib/bridgeClient.js';
import { bucket, report } from '../lib/telemetryClient.js';
import { missedFieldTypes, type MissedFieldType } from '../lib/coverage.js';
import { withBuiltinRules } from '../lib/builtinRules.js';
import { repairFills, type Attempt } from '../lib/fillRepair.js';
import { UNMAPPABLE } from '../lib/aiFieldMap.js';
import { cacheMap, getCachedMap, labelKey } from '../lib/fieldMapCache.js';
import { isAtsHost, isCaptureAllowed, setSiteOptIn, upsertCapture, type CaptureField } from '../lib/captureStore.js';
import { buildCandidateContext } from '../lib/aiClient.js';
import { loadConnection } from '../lib/connectionStore.js';
import { getResumeFile } from '../lib/resumeFileStore.js';
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

/** Fields nobody needs to double-check: if we got the label right at all, the value is simply theirs. */
const OBVIOUS_KEYS = new Set<string>([
  'firstName',
  'middleName',
  'lastName',
  'fullName',
  'preferredName',
  'email',
  'phone',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'zipCode',
  'country',
  'location',
  'linkedin',
  'github',
  'website',
  'currentCompany',
  'currentTitle',
  'school',
  'degree',
  'fieldOfStudy',
]);

// Which wizard step we've already grown repeated sections for (#136). Clicking "Add another" is real
// page interaction, so it must happen once per step — not once per fill pass.
let expandedFor = '';

// How many fields the AI mapper resolved on the last run — surfaced in the popup so the feature is
// observable when testing it by hand (otherwise it works silently and looks like nothing happened).
let aiMappedCount = 0;

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
 * Load the page-world value bridge (pageBridge.ts) into the page's OWN JS world.
 *
 * It has to run there to reach React's per-world expandos (`__reactProps`, `_valueTracker`) — a content
 * script literally cannot see them. We inject it as a <script src> from web_accessible_resources rather
 * than declaring a `"world": "MAIN"` content script: that manifest key made Chrome reject the whole
 * extension in our test browser (every golden went red because NOTHING was injected), and this form
 * works on the same Chrome versions we already support. Injected once, lazily, on first use.
 */
let bridgeReady: Promise<void> | null = null;
function injectPageBridge(): Promise<void> {
  if (bridgeReady) return bridgeReady;
  bridgeReady = new Promise<void>((resolve) => {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('content/pageBridge.js');
      s.onload = () => {
        s.remove(); // the listener stays registered; the tag itself is noise
        resolve();
      };
      s.onerror = () => resolve(); // no bridge → callers fall back to plain assignment
      (document.head ?? document.documentElement).appendChild(s);
    } catch {
      resolve();
    }
  });
  return bridgeReady;
}

/**
 * Fill what our rules couldn't, using AI to decide WHICH profile field answers each leftover question.
 *
 * Order matters: the per-site cache is consulted first, so the model is asked once per form shape and
 * every later application on that ATS is instant and offline. Only genuinely-new labels cost a call.
 *
 * Privacy: we send the model the field LABELS and the NAMES of the user's profile fields — never a
 * value (see aiFieldMap). Everything it maps is written locally and marked for review, because an
 * inferred mapping deserves a human glance before submitting.
 */
async function aiMapUnfilled(fp: FullProfile, attempted: Set<Element>): Promise<number> {
  const host = location.hostname.replace(/^www\./, '');
  // Candidates: detected, visible, still empty, and not something the engine already handled.
  const open: { id: number; label: string; kind?: string; el: HTMLElement }[] = [];
  for (const f of detectFields(document)) {
    const el = f.el;
    if (!(el instanceof HTMLElement) || attempted.has(el)) continue;
    if (String((el as HTMLInputElement).value ?? '').trim()) continue;
    const label = (f.label ?? '').trim();
    if (!label || label.length > 160) continue;
    open.push({ id: open.length + 1, label, kind: f.kind, el });
  }
  if (!open.length) return 0;

  const cached = await getCachedMap(host);
  const resolved = new Map<number, string>(); // question id → profile key
  const ask: { id: number; label: string; kind?: string; options?: string[] }[] = [];
  for (const q of open) {
    const hit = cached[labelKey(q.label)];
    if (hit) resolved.set(q.id, hit);
    else ask.push({ id: q.id, label: q.label, kind: q.kind });
  }

  // Ask the model only about labels we've never seen on this site.
  if (ask.length) {
    const res = (await chrome.runtime
      .sendMessage({ type: 'f2a-ai', method: 'mapFields', params: { questions: ask, profile: fp.profile } })
      .catch(() => null)) as { result?: { map?: Record<string, string> } } | undefined;
    const learned: Record<string, ProfileKey> = {};
    for (const [idStr, key] of Object.entries(res?.result?.map ?? {})) {
      const q = open.find((o) => o.id === Number(idStr));
      if (!q || !key) continue;
      resolved.set(q.id, key);
      learned[labelKey(q.label)] = key as ProfileKey;
    }
    if (Object.keys(learned).length) await cacheMap(host, learned);
  }
  if (!resolved.size) return 0;

  // Write through the same verified path as everything else (combobox driver / page-world bridge).
  const writes: Attempt[] = [];
  for (const q of open) {
    const key = resolved.get(q.id) as ProfileKey | undefined;
    const value = key ? fp.profile[key] : undefined;
    if (value) writes.push({ el: q.el, value: String(value) });
  }
  if (!writes.length) return 0;
  const { confirmed } = await repairFills(writes, 6000);
  // An AI-inferred mapping is a judgement call — outline it so the user checks before submitting.
  for (const w of writes) if (w.el instanceof HTMLElement) markReview(w.el);
  return confirmed;
}

/**
 * How many fillable controls currently hold a value — the DOM's own answer, used to report what
 * autofill ACTUALLY landed rather than what it attempted (#136). Counts hidden controls too, since
 * several ATS keep the real <select> off-screen behind a custom widget.
 */
function filledControlCount(): number {
  let n = 0;
  for (const el of document.querySelectorAll('input,textarea,select')) {
    const t = (el as HTMLInputElement).type;
    if (t === 'hidden' || t === 'submit' || t === 'button') continue;
    const held =
      t === 'checkbox' || t === 'radio'
        ? (el as HTMLInputElement).checked
        : String((el as HTMLInputElement).value ?? '').trim() !== '';
    if (held) n++;
  }
  return n;
}

/** Best-effort visible label for a control — used to spot attestation questions we must not answer. */
function describeField(el: HTMLElement): string {
  const id = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  return (
    id?.textContent ||
    el.getAttribute('aria-label') ||
    el.closest('label')?.textContent ||
    (el as HTMLInputElement).name ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Set a field's value the way React/controlled inputs accept (native setter + input/change events). */
function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// The fields the AI drafted this run — so the popup can offer a per-field re-draft with a custom
// instruction ("if you don't like the AI answer, tell it what to change").
let draftedFields: { el: HTMLElement; label: string }[] = [];

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
    for (const a of learnableAnswers(document, { profile: fp.profile, userRules: withBuiltinRules(fp.rules), store })) {
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

/**
 * Is this page worth scanning at all? Deliberately crude and fast — one selector, no label work.
 * A job application has several fillable controls or a file upload; a dashboard or inbox does not.
 * Known ATS hosts always qualify, so a slow-rendering application page isn't dismissed too early.
 */
function looksFormish(): boolean {
  if (isAtsHost(location.hostname) || siteOptedIn) return true;
  let fillable = 0;
  for (const el of document.querySelectorAll('input,textarea,select')) {
    const t = (el as HTMLInputElement).type;
    if (t === 'hidden' || t === 'submit' || t === 'button' || t === 'search') continue;
    if (t === 'file') return true; // résumé upload is a strong signal on its own
    if (++fillable >= 3) return true;
  }
  return false;
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
    // Which ATS powers this page (own fixed enum, from the DOM fingerprint) — surfaced so a bug report
    // says "workday" instead of making us guess from the URL.
    atsPlatform: detectAts(document) ?? (isRelevantPage() ? 'generic' : null),
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
): Promise<{
  filled: number;
  claimed: number;
  aiMapped: number;
  sync: number;
  interactive: number;
  review: number;
  total: number;
  partial?: boolean;
  missedTypes: MissedFieldType[];
} | null> {
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
    userRules: withBuiltinRules(fp.rules),
    fillSensitive,
    store,
  };
  const heldBefore = filledControlCount(); // DOM truth baseline — see the honest count below
  // 1) grow repeated sections so there's a row per role/school ("Add another") — ONCE per page (#136).
  // This clicks real "Add another" buttons, so repeating it on every pass was the bulk of the ~25 clicks
  // a single run dispatched, and each click makes the browser scroll to it (the "up and down" churn).
  // A wizard step change resets the guard (see stepSignature below) so a later step still expands.
  if (expandedFor !== stepSignature()) {
    expandedFor = stepSignature();
    await expandRepeatingSections(document, { experience: fp.experience?.length, education: fp.education?.length });
  }
  // 2) synchronous fill (text/select/radio + multi-row groups) — fast, always completes.
  // NB: fill runs against the whole document — scoping to formRegion() was tried (#13) but broke
  // Workday, whose fields span wider than the detected-field common ancestor. The engine gates the
  // actual field mapping, so this isn't a mis-fill in practice.
  const report = autofillForm({ root: document, ...common });
  // Remember what WE filled — in an isolated-world WeakMap, NOT page-readable data-* attributes (#12) —
  // so a later capture can tell autofill from manual entry without exposing the values to the page.
  clearReviewMarks(); // fresh run → drop last run's outlines
  const attempts: Attempt[] = [];
  for (const r of report.results) {
    if (r.field.el instanceof HTMLElement) {
      if (r.status === 'filled') {
        filledValues.set(r.field.el, String(r.value));
      } else if (r.status === 'review' && !OBVIOUS_KEYS.has(r.resolution?.key ?? '')) {
        // Outline only what genuinely needs a human look. Basic contact details are unambiguous even
        // when the engine reports low confidence, and ringing every one of them in violet made the
        // whole form look like it needed re-checking — which trains people to ignore the marks.
        markReview(r.field.el);
      }
      // Anything the ENGINE resolved to a value is a repair candidate — including custom comboboxes it
      // can't write to. Using the engine's value (not our own re-resolution) keeps its rationalization
      // safety, which is what stops "employment agreements?" being answered with a company name.
      if (r.value) attempts.push({ el: r.field.el, value: String(r.value), source: r.resolution?.source });
    }
  }
  // 2a) SAFETY: never answer an attestation on the user's behalf. The engine will happily match
  //     "Do you consent to a background check?" to a profile "Yes" — observed live. Consents, criminal
  //     history and certifications are the user's to give personally; a pre-ticked "Yes" they don't
  //     notice is a real harm, so anything we wrote into such a field is cleared and flagged instead.
  //     (Employment-agreement questions are exempt: the owner set a reviewed default of "No".)
  for (const a of attempts.slice()) {
    const el = a.el;
    if (!(el instanceof HTMLElement)) continue;
    const label = describeField(el);
    if (!label || !UNMAPPABLE.test(label)) continue;
    if (/employment agreement|non-?compete|post-?employment|restrictive covenant/i.test(label)) continue;
    // The user's OWN rule is explicit intent — if they've decided in advance how to answer consent
    // questions, honour it. What we refuse is a COINCIDENCE: on a probe form the engine answered
    // "Do you consent to a background check?" with the profile's workAuthorization "Yes" — the right
    // word from the wrong question. Only heuristic/fuzzy matches are cleared.
    if (a.source === 'user') continue;
    try {
      const input = el as HTMLInputElement;
      if (input.type === 'checkbox' || input.type === 'radio') input.checked = false;
      else Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {
      /* best effort — the flag below still tells the user to check it */
    }
    attempts.splice(attempts.indexOf(a), 1);
    markReview(el); // outline it: this one needs a human answer
  }

  // 2b) VERIFY the writes actually landed, and repair the ones the page threw away. React & co. own
  //     their inputs' values, so a plain assignment from this (isolated) world is discarded on the next
  //     render — measured live: 14 "filled", only 5 real. repairFills re-writes those through the
  //     page-world bridge and returns the count the DOM confirms, so `filled` stops lying.
  await injectPageBridge();
  const { confirmed, repaired } = await repairFills(attempts);
  if (repaired) report.filled = confirmed;
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
        // Last: let AI map the questions our rules didn't recognise (cache-first, so usually free).
        // Deliberately AFTER everything deterministic — AI only ever sees what's still empty.
        aiMappedCount = await aiMapUnfilled(fp, new Set(attempts.map((a) => a.el)));
        const aiMapped = aiMappedCount;
        return live.comboboxes + live.dates + uploaded + aiMapped;
      })(),
      mode === 'ats' ? 45_000 : 20_000,
      signal,
    );
  } catch {
    partial = true; // timed out or cancelled — the synchronous fields are still filled
  }
  void captureFlow(); // record the autofilled state into the corpus
  // Coverage (Layer 1, #105): which TYPES of field we detected but couldn't fill — bounded enum only,
  // no label text or values (see coverage.ts). Feeds "where is autofill weak?" telemetry.
  // HONEST COUNT (#136): report what the DOM actually holds, not what we attempted. The interactive
  // widget pass self-reports successes that frequently don't land on custom dropdowns — measured live:
  // it claimed 9 fills on a Greenhouse form where the page gained none. Counting the real delta stops
  // the popup telling the user "14 filled" when 5 landed, and makes every future fix measurable.
  const landed = Math.max(0, filledControlCount() - heldBefore);
  return {
    filled: landed,
    claimed: report.filled + extra,
    // Attribution: synchronous engine (verified + repaired against the DOM) vs the interactive widget
    // pass (comboboxes/dates/uploads), which is where the claimed-vs-landed gap lives.
    sync: report.filled,
    interactive: extra,
    aiMapped: aiMappedCount,
    review: report.review,
    total: report.total,
    partial,
    missedTypes: missedFieldTypes(report.results),
  };
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
): Promise<{
  filled: number;
  review: number;
  total: number;
  partial?: boolean;
  sync: number;
  interactive: number;
  aiMapped: number;
  steps: number;
  stopped: string;
  missedTypes: MissedFieldType[];
}> {
  let filled = 0;
  let sync = 0;
  let interactive = 0;
  let aiMapped = 0;
  let review = 0;
  let total = 0;
  let steps = 0;
  let stopped = 'done';
  const missed = new Set<MissedFieldType>(); // union of missed field types across all wizard steps
  for (let i = 0; i < 12; i++) {
    if (signal?.aborted) {
      stopped = 'cancelled';
      break;
    }
    // ONE pass per step, retried ONLY if it threw (#136). A framework re-render (Taleo JSF postbacks,
    // BrassRing/Oracle Angular/Knockout) can invalidate element refs mid-fill and throw; that case
    // genuinely needs a fresh re-detect. But retrying unconditionally meant every single-page form got
    // two full detect+fill passes — doubling the real clicks we dispatch into the page for no gain
    // (measured: pass 2 added 0 fills on a live Greenhouse form). Newly-revealed fields are handled by
    // the DOM-change watcher below instead of by blind repetition.
    let r: Awaited<ReturnType<typeof runAutofill>> = null;
    for (let pass = 0; pass < 2; pass++) {
      if (signal?.aborted) break;
      try {
        r = await runAutofill(mode, signal);
        break; // succeeded → no blind second pass (#136)
      } catch {
        await sleep(400); // DOM re-rendered mid-pass — let it settle, then re-detect once
      }
    }
    if (r) {
      filled += r.filled;
      sync += r.sync;
      interactive += r.interactive;
      aiMapped += r.aiMapped;
      review += r.review;
      total += r.total;
      r.missedTypes.forEach((t) => missed.add(t));
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
  return { filled, sync, interactive, aiMapped, review, total, steps, stopped, missedTypes: [...missed].sort() };
}

/** How many fillable, visible controls the page currently shows — the signal for "the form grew". */
function fillableCount(): number {
  let n = 0;
  for (const el of document.querySelectorAll('input,textarea,select')) {
    const t = (el as HTMLInputElement).type;
    if (t === 'hidden' || t === 'submit' || t === 'button') continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.width > 0) n++;
  }
  return n;
}

/**
 * Fill fields that appear AFTER an explicit autofill (#136).
 *
 * Some flows reveal a form only once something is filled or a gate is passed (Jobvite's residence
 * consent, lazy sections). The popup used to handle that by blindly re-running the whole fill whenever
 * `fields > filled + 3` — a condition that is true on any page we fill poorly, so it fired constantly
 * and (measured on a live Greenhouse form) added ZERO fills while doubling the clicks we dispatch.
 *
 * Instead, watch the DOM for a short window after the run and fill again ONLY if the page genuinely
 * grew new fillable fields — debounced so a burst of mutations triggers one fill, not dozens. This is
 * the model the mature autofill extensions use (observe + debounce) rather than blind repetition.
 * Still user-initiated: the watcher only exists in the seconds following a fill the user asked for.
 */
async function fillRevealedFields(mode: 'default' | 'ats', signal?: AbortSignal): Promise<number> {
  const WINDOW_MS = 4000; // hard cap: never hold the UI longer than this
  const QUIET_MS = 1200; // a page that stops mutating isn't going to reveal anything — stop early
  const SETTLE_MS = 400; // debounce: a burst of mutations triggers ONE fill, not dozens
  const baseline = fillableCount();
  return new Promise<number>((resolve) => {
    let done = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const finish = (n: number) => {
      if (done) return;
      done = true;
      clearTimeout(settle);
      clearTimeout(quiet);
      clearTimeout(deadline);
      obs.disconnect();
      resolve(n);
    };
    // Restarted on every mutation: if the DOM goes quiet, nothing more is coming.
    let quiet = setTimeout(() => finish(0), QUIET_MS);
    const obs = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(() => finish(0), QUIET_MS);
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (signal?.aborted) return finish(0);
        if (fillableCount() <= baseline) return; // no NEW fields — keep watching, never blind-refill
        void runAutofill(mode, signal)
          .then((r) => finish(r?.filled ?? 0))
          .catch(() => finish(0));
      }, SETTLE_MS);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const deadline = setTimeout(() => finish(0), WINDOW_MS);
  });
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
  // Standalone / BYO (no desktop, or the desktop had no résumé): attach the résumé file the user
  // uploaded in Options. This is what makes résumé upload work on real forms without the app.
  if (!out.resume) {
    const stored = await getResumeFile();
    if (stored?.base64)
      out.resume = base64ToFile(stored.base64, stored.fileName || 'resume.pdf', stored.mimeType || 'application/pdf');
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
  const questions = unmappedQuestions(document, { profile: fp.profile, userRules: withBuiltinRules(fp.rules), store });
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
  draftedFields = [];
  qs.forEach((q, i) => {
    const answer = answers[i];
    if (!answer) return;
    setFieldValue(q.el as HTMLInputElement | HTMLTextAreaElement, answer);
    markReview(q.el as HTMLElement); // AI drafts always need a look before submitting
    draftedFields.push({ el: q.el as HTMLElement, label: q.label }); // enable per-field re-draft
    filled++;
  });
  return filled ? { ok: true, filled, usage } : { ok: false, error: 'No draft' };
}

/** Re-draft ONE previously-drafted field, steered by the user's own instruction, and replace its value. */
async function redraftField(
  label: string,
  instruction: string,
): Promise<{ ok: boolean; text?: string; usage?: AiUsage | null; error?: string }> {
  const target = draftedFields.find((d) => d.label === label && d.el.isConnected);
  if (!target) return { ok: false, error: 'Draft answers again first, then refine.' };
  if (!instruction.trim()) return { ok: false, error: 'Add an instruction.' };
  const fp = await getFullProfile();
  if (!fp) return { ok: false, error: 'No profile' };
  const job = pageJob();
  const question = `${label}\n\nRewrite this answer following the candidate's instruction — keep it honest and grounded in the brief: ${instruction}`;
  let text = '';
  let usage: AiUsage | null = null;
  if (await isTestActive()) {
    text = draftDummyAnswer(`${label} (${instruction})`, fp.profile);
  } else {
    const context = buildCandidateContext(
      fp.profile as Record<string, unknown>,
      fp.experience ?? [],
      fp.education ?? [],
    );
    const byo = await aiAnswers(context, job, [question]);
    if (byo.answers?.length) {
      text = byo.answers[0];
      usage = byo.usage ?? null;
    } else if (byo.error === 'no-key' && connection) {
      try {
        text = (await bridgeRpc<{ text?: string }>('answer', { ...job, question }))?.text ?? '';
      } catch {
        /* fall through */
      }
    } else if (byo.error) return { ok: false, error: byo.error };
  }
  if (!text) return { ok: false, error: 'No answer' };
  setFieldValue(target.el as HTMLInputElement | HTMLTextAreaElement, text);
  markReview(target.el);
  return { ok: true, text, usage };
}

async function init() {
  connection = await loadConnection();
  const local = await loadFullProfile();
  hasLocalProfile = !!local && Object.keys(local.profile ?? {}).length > 0;
  testMode = await loadTestMode();
  // NOT awaited: probing the desktop bridge walks 5 localhost ports at 1.5s each, and with no app
  // running that blocked the rest of init() — including the RPC listener registered below — for up to
  // 7.5s. During that window the popup asked "how many fields?" and got no answer at all, so a perfectly
  // fillable page reported "0 fillable fields". Connection status just updates a moment later instead.
  void checkBridge();
  captureMode = await loadCaptureMode();
  autoCaptureOn = await loadAutoCapture();
  needsSponsorship = await loadNeedsSponsorship();
  hideUnsponsored = await loadHideUnsponsored();
  siteOptedIn = !isAtsHost(location.hostname) && (await isCaptureAllowed(location.hostname));

  // Reflect setting changes from the options page without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    // Saving the profile in Options must take effect on pages that are ALREADY open. Without this the
    // content script kept the value it read at page load, so right after setting up a profile the popup
    // still said "Profile not set up" until you reloaded the tab — reported from real use.
    if ('f2a_full_profile' in changes) {
      const fp = changes['f2a_full_profile'].newValue as FullProfile | undefined;
      hasLocalProfile = !!fp && Object.keys(fp.profile ?? {}).length > 0;
      updateBadge(); // refresh the toolbar count + "relevant page" state too
    }
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
      // CHEAP GATE FIRST. Since the content script runs on <all_urls>, this callback fires on every
      // mutation burst of every page you visit — including apps like mail and docs that mutate
      // constantly. Running the full detectFields + per-field resolution + badge passes there was
      // continuous wasted work and a real risk to browser responsiveness. A single querySelectorAll
      // costs nothing and rules out the overwhelming majority of pages.
      if (!looksFormish()) return;
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
}

/**
 * Wire the popup's RPC IMMEDIATELY, at module load — never behind init()'s awaits.
 *
 * This used to live at the end of init(), so any slow or failing step before it (a desktop-bridge probe
 * walking five localhost ports, a storage read on a fresh install) left the content script deaf. The
 * popup would ask "how many fields are here?", get no answer at all, and show "0 fillable fields" on a
 * page full of them — the extension looked broken on exactly the pages it should handle. Registering
 * first means we always answer; handlers read module state that init() fills in a moment later.
 */
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
          // A gate/lazy section can reveal more fields right after the fill. Wait briefly and fill
          // only what genuinely appeared (#136) — replaces the popup's blind whole-form re-run.
          if (r && !ctrl.signal.aborted) {
            const extra = await fillRevealedFields(msg.params?.mode ?? 'default', ctrl.signal);
            r.filled += extra;
          }
          // Coverage telemetry (Layer 1, #105): which ATS + how many fields + which TYPES we missed.
          // All metadata-only — a bounded platform enum, coarse count buckets, and a fixed field-type
          // vocabulary (coverage.ts). Never the URL, company, labels, or values. `missed_types` is a
          // sorted CSV of the bounded enum, capped so the emitted string stays low-cardinality.
          report('autofill_run', {
            ok: !!r && r.filled > 0,
            fields_filled: bucket(r?.filled ?? 0),
            fields_total: bucket(r?.total ?? 0),
            ats_platform: detectAts(document) ?? 'generic',
            missed_types: (r?.missedTypes ?? []).slice(0, 10).join(','),
          });
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
        case 'draftedList':
          sendResponse({ items: draftedFields.filter((d) => d.el.isConnected).map((d) => ({ label: d.label })) });
          break;
        case 'redraft': {
          const rp = (msg.params ?? {}) as { label?: string; instruction?: string };
          sendResponse(await redraftField(String(rp.label ?? ''), String(rp.instruction ?? '')));
          break;
        }
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

void init();
