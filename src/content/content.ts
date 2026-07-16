import { autofillForm, autofillInteractive, captureCoverage, cleanClone, deriveFullProfile, detectFileInputs, detectFields, expandRepeatingSections, readLazyOptions, setInputFile, type CoverageReport, type FullProfile } from '@first2apply/autofill';

import { rpc, type BridgeConnection } from '../lib/bridgeClient.js';
import { loadConnection } from '../lib/connectionStore.js';
import { loadCaptureMode, loadFillSensitive, loadFullProfile, loadTestMode } from '../lib/profileStore.js';
import { textToPdfFile } from '../lib/pdf.js';
import { dummyCoverLetterFile, dummyResumeFile } from '../lib/testFiles.js';
import { TEST_PROFILE } from '../lib/testProfile.js';
import { mountPanel } from './panel.js';

/**
 * Content script (Phase 7.2/7.3): injects the docked panel, keeps the toolbar badge
 * in sync, and autofills the page. Works **standalone** (local profile, no desktop)
 * for autofill; the AI actions use the desktop bridge when connected.
 */

let connection: BridgeConnection | null = null;
let hasLocalProfile = false;
let testMode = false;
let captureMode = false;
let fieldCount = 0;

function mode(): 'connected' | 'standalone' | 'none' {
  if (connection) return 'connected';
  return hasLocalProfile ? 'standalone' : 'none';
}

/**
 * The profile to fill from. In TEST MODE this is always the built-in anonymous
 * TEST_PROFILE (so nothing real is exposed on a live page). Otherwise prefer the
 * desktop's résumé-derived profile, falling back to the local standalone one.
 */
async function getFullProfile(): Promise<FullProfile | null> {
  if (await loadTestMode()) return TEST_PROFILE;
  const p = connection?.profile as Parameters<typeof deriveFullProfile>[0] | undefined;
  if (p?.basics) return deriveFullProfile(p);
  return await loadFullProfile();
}

function updateBadge(): void {
  fieldCount = detectFields(document).length;
  void chrome.runtime.sendMessage({ type: 'f2a-detected', count: fieldCount }).catch(() => {});
}

async function runAutofill(): Promise<{ filled: number; review: number; total: number } | null> {
  const fp = await getFullProfile();
  if (!fp || Object.keys(fp.profile).length === 0) return null;
  const fillSensitive = await loadFillSensitive();
  const common = { profile: fp.profile, experience: fp.experience, education: fp.education, userRules: fp.rules, fillSensitive };
  // 1) grow repeated sections so there's a row per role/school ("Add another")
  await expandRepeatingSections(document, { experience: fp.experience?.length, education: fp.education?.length });
  // 2) synchronous fill (text/select/radio + multi-row groups)
  const report = autofillForm({ root: document, ...common });
  // 3) async pass for widgets that only fill through live interaction
  //    (Workday lazy comboboxes + Month/Day/Year date pickers)
  const live = await autofillInteractive({ root: document, ...common });
  // 4) résumé / cover-letter upload
  const uploaded = await uploadDocuments();
  return { filled: report.filled + live.comboboxes + live.dates + uploaded, review: report.review, total: report.total };
}

/**
 * Attach the résumé / cover letter to the page's file inputs. Test mode uses bundled
 * dummy PDFs; otherwise (future) the latest generated docs from the connected desktop
 * app. Only résumé/cover-letter inputs are touched — never a generic attachment field.
 */
async function uploadDocuments(): Promise<number> {
  const inputs = detectFileInputs(document).filter((f) => f.kind === 'resume' || f.kind === 'coverLetter');
  if (!inputs.length) return 0;
  const testMode = await loadTestMode();
  const files: { resume?: File; coverLetter?: File } = testMode
    ? { resume: dummyResumeFile(), coverLetter: dummyCoverLetterFile() }
    : await realDocuments();
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
async function realDocuments(): Promise<{ resume?: File; coverLetter?: File }> {
  const out: { resume?: File; coverLetter?: File } = {};
  if (connection) {
    try {
      const r = await rpc<{ fileName?: string; base64?: string; mimeType?: string }>(connection.port, connection.token, 'resumeFile', {});
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
async function capturePage(): Promise<{ total: number; resolved: number; unresolved: number; unresolvedLabels: string[] } | null> {
  try {
    // open every lazy combobox so its options render into the DOM we serialize
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"], [aria-haspopup="listbox"]'))) {
      await readLazyOptions(el, 400);
    }
    const report: CoverageReport = captureCoverage(document, { url: location.href });
    // scrub the user's own profile values from the saved HTML (belt-and-suspenders;
    // in test mode the page holds only dummy data anyway)
    const fp = await loadFullProfile();
    const scrub = Object.values(fp?.profile ?? {}).filter((v): v is string => typeof v === 'string');
    const html = cleanClone(document.documentElement, scrub);
    const host = location.hostname.replace(/^www\./, '').split('.')[0] || 'page';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    triggerDownload(`${host}-${stamp}.html`, html, 'text/html');
    triggerDownload(`${host}-${stamp}.coverage.json`, JSON.stringify(report, null, 2), 'application/json');
    return { total: report.total, resolved: report.resolved, unresolved: report.unresolved, unresolvedLabels: report.unresolvedLabels };
  } catch (e) {
    void e;
    return null;
  }
}

/** Best-effort "this job" from the page for the AI actions (rough JD extraction). */
function pageJob() {
  return {
    title: document.title.slice(0, 200),
    company: location.hostname.replace(/^www\./, '').split('.')[0],
    description: (document.body?.innerText ?? '').slice(0, 8000),
  };
}

async function analyzeJob(): Promise<{ ats?: number | null; visa?: string; error?: string } | null> {
  if (!connection) return null;
  try {
    const job = pageJob();
    const [kw, visa] = await Promise.all([
      rpc<{ atsMatchPercent?: number }>(connection.port, connection.token, 'keywords', job).catch(() => null),
      rpc<{ h1b?: { employer?: string } | null; uk?: { organisation?: string } | null }>(connection.port, connection.token, 'visa', { company: job.company }).catch(() => null),
    ]);
    const visaLabel = visa?.h1b ? 'Known H-1B sponsor' : visa?.uk ? 'UK visa sponsor' : undefined;
    return { ats: kw?.atsMatchPercent ?? null, visa: visaLabel };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Analysis failed' };
  }
}

async function init() {
  connection = await loadConnection();
  const local = await loadFullProfile();
  hasLocalProfile = !!local && Object.keys(local.profile ?? {}).length > 0;
  testMode = await loadTestMode();
  captureMode = await loadCaptureMode();
  updateBadge();

  // Reflect test/capture-mode changes from the options page without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('f2a_test_mode' in changes) testMode = !!changes['f2a_test_mode'].newValue;
    if ('f2a_capture_mode' in changes) captureMode = !!changes['f2a_capture_mode'].newValue;
    panel.update();
  });

  const panel = mountPanel({
    version: chrome.runtime.getManifest().version,
    getState: () => ({ mode: mode(), fields: fieldCount, testMode, captureMode }),
    onAutofill: runAutofill,
    onAnalyze: analyzeJob,
    onCapture: capturePage,
    onOpenOptions: () => void chrome.runtime.sendMessage({ type: 'f2a-open-options' }).catch(() => {}),
  });

  // Re-detect on SPA/DOM changes (debounced) → refresh badge + panel count.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      updateBadge();
      panel.update();
    }, 500);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'f2a-run-autofill') void runAutofill();
  });
}

void init();
