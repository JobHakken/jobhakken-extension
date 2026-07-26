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
  readLazyOptions,
  resolveField,
  setInputFile,
  type CoverageReport,
  type FullProfile,
  type Profile,
} from '@jobhakken/autofill';

import { type BridgeConnection } from '../lib/bridgeClient.js';
import { bucket, report } from '../lib/telemetryClient.js';
import { isAtsHost, isCaptureAllowed, setSiteOptIn, upsertCapture, type CaptureField } from '../lib/captureStore.js';
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
  const fillSensitive = await loadFillSensitive();
  const common = {
    profile: fp.profile,
    experience: fp.experience,
    education: fp.education,
    userRules: fp.rules,
    fillSensitive,
  };
  // 1) grow repeated sections so there's a row per role/school ("Add another")
  await expandRepeatingSections(document, { experience: fp.experience?.length, education: fp.education?.length });
  // 2) synchronous fill (text/select/radio + multi-row groups) — fast, always completes
  const report = autofillForm({ root: document, ...common });
  // tag what WE filled, so a later capture can tell autofill from manual entry
  for (const r of report.results) {
    if (r.status === 'filled' && r.field.el instanceof HTMLElement) {
      r.field.el.dataset.f2aFilled = '1';
      r.field.el.dataset.f2aValue = String(r.value);
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
      const tagged = el.dataset?.f2aFilled === '1' && el.dataset?.f2aValue === val;
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
async function draftAnswer(): Promise<{ ok: boolean; error?: string } | null> {
  if (await isTestActive()) return { ok: false, error: 'off in test mode' }; // would use the real résumé
  if (!connection) return { ok: false, error: 'Connect the app' };
  // Only fill a textarea that has an actual associated QUESTION (label / aria-label / labelledby /
  // question-like placeholder) — never a random empty box like a "message the recruiter" or LinkedIn
  // "add a note" field. Prefer one inside a <form> (a real application question). (#10)
  const questionFor = (t: HTMLTextAreaElement): string => {
    const byId = t.getAttribute('aria-labelledby');
    const labelledby = byId ? (document.getElementById(byId)?.textContent ?? '') : '';
    const ph = /\?|why|describe|explain|cover letter|reason|tell us/i.test(t.placeholder) ? t.placeholder : '';
    return (t.labels?.[0]?.textContent || t.getAttribute('aria-label') || labelledby || ph).trim();
  };
  const empty = (Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[]).filter(
    (t) => !t.value.trim() && t.offsetParent !== null && questionFor(t),
  );
  const ta = empty.find((t) => t.closest('form')) ?? empty[0];
  if (!ta) return { ok: false, error: 'No question field' };
  try {
    const label = questionFor(ta) || 'Why are you a good fit?';
    const r = await bridgeRpc<{ text?: string }>('answer', { ...pageJob(), question: label });
    if (!r?.text) return { ok: false, error: 'No draft' };
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(ta, r.text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
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
      switch (msg.method) {
        case 'getState':
          sendResponse(getState());
          break;
        case 'autofill': {
          autofillAbort?.abort(); // supersede any in-flight run
          const ctrl = (autofillAbort = new AbortController());
          const r = await runAutofill(msg.params?.mode ?? 'default', ctrl.signal);
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
    })();
    return true; // async sendResponse
  });
}

void init();
