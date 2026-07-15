import { autofillForm, autofillInteractive, deriveFullProfile, detectFields, type FullProfile } from '@first2apply/autofill';

import { rpc, type BridgeConnection } from '../lib/bridgeClient.js';
import { loadConnection } from '../lib/connectionStore.js';
import { loadFillSensitive, loadFullProfile, loadTestMode } from '../lib/profileStore.js';
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
  const report = autofillForm({ root: document, ...common });
  // second, async pass for widgets that only fill through live interaction
  // (Workday lazy comboboxes + Month/Day/Year date pickers)
  const live = await autofillInteractive({ root: document, ...common });
  return { filled: report.filled + live.comboboxes + live.dates, review: report.review, total: report.total };
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
  updateBadge();

  // Reflect test-mode changes from the options page without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'f2a_test_mode' in changes) {
      testMode = !!changes['f2a_test_mode'].newValue;
      panel.update();
    }
  });

  const panel = mountPanel({
    getState: () => ({ mode: mode(), fields: fieldCount, testMode }),
    onAutofill: runAutofill,
    onAnalyze: analyzeJob,
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
