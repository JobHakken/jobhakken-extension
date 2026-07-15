import { autofillForm, deriveProfile, detectFields, type Profile } from '@first2apply/autofill';

import { rpc, type BridgeConnection } from '../lib/bridgeClient.js';
import { loadConnection } from '../lib/connectionStore.js';
import { loadProfile } from '../lib/profileStore.js';
import { mountPanel } from './panel.js';

/**
 * Content script (Phase 7.2/7.3): injects the docked panel, keeps the toolbar badge
 * in sync, and autofills the page. Works **standalone** (local profile, no desktop)
 * for autofill; the AI actions use the desktop bridge when connected.
 */

let connection: BridgeConnection | null = null;
let hasLocalProfile = false;
let fieldCount = 0;

function mode(): 'connected' | 'standalone' | 'none' {
  if (connection) return 'connected';
  return hasLocalProfile ? 'standalone' : 'none';
}

/** Prefer the desktop's résumé-derived profile; fall back to the local standalone one. */
async function getProfile(): Promise<Profile | null> {
  const p = connection?.profile as
    | {
        basics?: { name?: string; email?: string; phone?: string; location?: string; website?: string; links?: Array<{ text?: string; url?: string }> };
        experience?: { company?: string; title?: string } | null;
        education?: { school?: string; degree?: string; field?: string } | null;
      }
    | undefined;
  if (p?.basics) {
    const b = p.basics;
    const findLink = (kw: string) => b.links?.find((l) => `${l.text ?? ''} ${l.url ?? ''}`.toLowerCase().includes(kw))?.url;
    return deriveProfile({
      name: b.name,
      email: b.email,
      phone: b.phone,
      location: b.location,
      website: b.website,
      linkedin: findLink('linkedin'),
      github: findLink('github'),
      currentCompany: p.experience?.company,
      currentTitle: p.experience?.title,
      school: p.education?.school,
      degree: p.education?.degree,
      fieldOfStudy: p.education?.field,
    });
  }
  return await loadProfile();
}

function updateBadge(): void {
  fieldCount = detectFields(document).length;
  void chrome.runtime.sendMessage({ type: 'f2a-detected', count: fieldCount }).catch(() => {});
}

async function runAutofill(): Promise<{ filled: number; review: number; total: number } | null> {
  const profile = await getProfile();
  if (!profile || Object.keys(profile).length === 0) return null;
  const report = autofillForm({ root: document, profile });
  return { filled: report.filled, review: report.review, total: report.total };
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
  hasLocalProfile = !!(await loadProfile());
  updateBadge();

  const panel = mountPanel({
    getState: () => ({ mode: mode(), fields: fieldCount }),
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
