/**
 * MV3 background service worker (Phase 7.2/7.3). Owns the toolbar badge (the "ON"
 * indicator), opens Options on request, routes the autofill trigger (keyboard command)
 * to the active tab, and — crucially — PROXIES all desktop-bridge calls. Bridge fetches
 * hit http://127.0.0.1; from a content script (page origin) the browser prompts the site
 * for local-device access on every page, so the content script messages us instead and
 * WE fetch (extension origin + host_permissions → no prompt). Ephemeral — no state.
 */
import { normalizeCompanyName } from '@jobhakken/core/build/sponsors';

import { draftAnswers, parseResumeToProfile } from '../lib/aiClient.js';
import { getAiConfig } from '../lib/aiKeyStore.js';
import { clearIdentity, fetchEntitlement, saveIdentity, WEB_APP_ORIGIN, type Identity } from '../lib/authStore.js';
import { rpc } from '../lib/bridgeClient.js';
import { loadConnection } from '../lib/connectionStore.js';
import { bestFrameId, clearTabFrames, recordFrameFields } from '../lib/frameStore.js';
import { mergeH1bRows } from '../lib/h1bLookup.js';
import { initGaSink } from '../lib/gaSink.js';
import { initPosthogSink } from '../lib/posthogSink.js';
import { saveFullProfile } from '../lib/profileStore.js';
import { acceptsResumeSchema, resumeDataToProfile } from '../lib/resumeReceive.js';
import { track } from '../lib/telemetry.js';

// ── Telemetry (metadata-only; opt-out; content can never pass the allowlist) ──────
// GA sink is active only in release builds (API secret injected at build time). Content
// scripts / options forward events here via a `jh-telemetry` message so a single sink runs.
initGaSink();
initPosthogSink(); // dual-sink the same metadata to PostHog (#106); inert until the key is built in
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void track('extension_installed', {});
    // First run: land the user on the setup page instead of a cold toolbar icon they have to
    // discover. The Options page carries the "Getting started" strip (onboarding dead-end #1).
    void chrome.runtime.openOptionsPage();
  }
});

// Cross-surface link (#358): the JobHakken website can (a) detect the extension is installed and
// (b) hand off a résumé — with no Chrome Web Store round-trip. `externally_connectable` already
// restricts *who* can reach this to our own origins; per CLAUDE.md we STILL treat the message as
// untrusted — re-check the sender origin, respond only to exact known types, and validate the résumé
// payload via @jobhakken/core before persisting. Nothing leaves the browser: the résumé travels
// website → extension locally into the same autofill profile the rest of the extension reads.
const JH_LINK_ORIGINS = new Set(['https://jobhakken.com', 'https://www.jobhakken.com', 'https://app.jobhakken.com']);
chrome.runtime.onMessageExternal?.addListener((msg, sender, sendResponse) => {
  let origin = sender.origin ?? '';
  if (!origin && sender.url) {
    try {
      origin = new URL(sender.url).origin;
    } catch {
      /* malformed sender.url — treat as no origin */
    }
  }
  if (!JH_LINK_ORIGINS.has(origin)) return; // defense-in-depth on top of externally_connectable
  const m = msg as { type?: unknown; schema?: unknown; schemaVersion?: unknown; payload?: unknown };

  if (m?.type === 'JH_EXT_PING') {
    // `capabilities` tells the site this build can receive a résumé (JH_EXT_RESUME) so it can show
    // "Send to extension" instead of only "installed".
    sendResponse({
      installed: true,
      version: chrome.runtime.getManifest().version,
      capabilities: ['resume-import'],
    });
    return; // synchronous
  }

  if (m?.type === 'JH_EXT_RESUME') {
    (async () => {
      try {
        // ADR-0005: the site sends a NUMERIC `schemaVersion` (= @jobhakken/core RESUME_SCHEMA_VERSION,
        // the same field the desktop app stamps on the bridge). See acceptsResumeSchema (also accepts
        // the legacy 'reactive-resume-v5' string during rollout).
        if (!acceptsResumeSchema(m)) {
          sendResponse({ ok: false, error: 'unsupported résumé schema version (need 5)' });
          return;
        }
        const fp = resumeDataToProfile(m.payload); // coerces + validates; throws on a non-résumé payload
        await saveFullProfile(fp);
        void track('resume_received', { source: 'web' }); // metadata only — no résumé content
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : 'invalid résumé payload' });
      }
    })();
    return true; // async — keep the message channel open for sendResponse
  }
  // Unknown type from a trusted origin → ignore (no ack); nothing to keep the channel open for.
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'jh-telemetry' && typeof msg.event === 'string') {
    void track(msg.event, msg.params ?? {}); // track() sanitizes: unknown events/params are dropped
  }
});

// ── H-1B sponsor lookup (bundled, standalone) ──────────────────────────────
// Loaded once from the packaged compact list (normalizedName \t approvals, sorted). Matching
// sums a company's exact + word-prefix entries ("emerson" → "emerson electric" + …) so a
// LinkedIn brand name resolves to the sum across its legal entities, mirroring the desktop.
let h1bNames: string[] | null = null;
let h1bApprovals: Int32Array | null = null;
let h1bLoading: Promise<void> | null = null;

// Cache the PARSED index in storage.session so an MV3 cold start (the SW is torn down when
// idle) doesn't re-fetch + re-parse the ~2.9 MB list every time — it survives the SW restart
// but is dropped when the browsing session ends.
const H1B_CACHE = 'f2a_h1b_index';

async function ensureH1b(): Promise<void> {
  if (h1bNames) return;
  if (!h1bLoading) {
    h1bLoading = (async () => {
      // 1) reuse a parsed index from an earlier SW lifetime, if present
      try {
        const got = await chrome.storage.session.get(H1B_CACHE);
        const cached = got[H1B_CACHE] as { names?: string; apps?: number[] } | undefined;
        if (cached?.names && cached.apps) {
          h1bNames = cached.names.split('\n');
          h1bApprovals = Int32Array.from(cached.apps);
          return;
        }
      } catch {
        /* no cache / storage unavailable — parse from the bundled file below */
      }
      // 2) parse the bundled compact list and cache the parsed form for the next cold start
      const txt = await (await fetch(chrome.runtime.getURL('data/h1b-sponsors.txt'))).text();
      const names: string[] = [];
      const apps: number[] = [];
      for (const line of txt.split('\n')) {
        const t = line.indexOf('\t');
        if (t < 0) continue;
        names.push(line.slice(0, t));
        apps.push(Number(line.slice(t + 1)) || 0);
      }
      h1bNames = names;
      h1bApprovals = Int32Array.from(apps);
      // names joined into one string keeps the serialized cache compact; parallel apps array
      try {
        await chrome.storage.session.set({ [H1B_CACHE]: { names: names.join('\n'), apps } });
      } catch {
        /* over quota / unavailable — fine, we still hold it in memory for this SW lifetime */
      }
    })();
  }
  await h1bLoading;
}

/** Sum approvals for a normalized query: exact match + word-prefix ("query …") matches. */
function h1bSum(query: string): number {
  const names = h1bNames;
  const apps = h1bApprovals;
  if (!names || !apps || !query) return 0;
  // binary search: first name >= query
  let lo = 0;
  let hi = names.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (names[mid] < query) lo = mid + 1;
    else hi = mid;
  }
  let sum = 0;
  for (let i = lo; i < names.length; i++) {
    const n = names[i];
    if (!n.startsWith(query)) break;
    if (n.length === query.length || n[query.length] === ' ') sum += apps[i]; // word boundary
  }
  return sum;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'f2a-h1b') return;
  if (sender.id !== chrome.runtime.id) return; // only our own contexts (consistency with sibling handlers)
  (async () => {
    try {
      await ensureH1b();
      const out: Record<string, number> = {};
      for (const raw of (msg.companies as string[]) ?? []) {
        const a = h1bSum(normalizeCompanyName(raw));
        if (a > 0) out[raw] = a;
      }
      sendResponse({ matches: out });
    } catch {
      sendResponse({ matches: {} });
    }
  })();
  return true; // async response
});

// ── H-1B per-company insights (roles / wages / filings) — powers the popup's premium detail panel ──
// Parallel compact list, prefix-summed the SAME way as h1bSum so a brand resolves across its legal
// entities (e.g. "amazon" → "amazon com services" + "amazon web services" + …).
let h1bRoleNames: string[] | null = null;
let h1bRoleRest: string[] | null = null;
let h1bRoleLoading: Promise<void> | null = null;
const H1B_ROLES_CACHE = 'f2a_h1b_roles';

async function ensureH1bRoles(): Promise<void> {
  if (h1bRoleNames) return;
  if (!h1bRoleLoading) {
    h1bRoleLoading = (async () => {
      try {
        const got = await chrome.storage.session.get(H1B_ROLES_CACHE);
        const cached = got[H1B_ROLES_CACHE] as { names?: string; rest?: string } | undefined;
        if (cached?.names && cached.rest) {
          h1bRoleNames = cached.names.split('\n');
          h1bRoleRest = cached.rest.split('\n');
          return;
        }
      } catch {
        /* no cache — parse the bundled file below */
      }
      const txt = await (await fetch(chrome.runtime.getURL('data/h1b-roles.txt'))).text();
      const names: string[] = [];
      const rest: string[] = [];
      for (const line of txt.split('\n')) {
        const t = line.indexOf('\t');
        if (t < 0) continue;
        names.push(line.slice(0, t));
        rest.push(line.slice(t + 1));
      }
      h1bRoleNames = names;
      h1bRoleRest = rest;
      try {
        await chrome.storage.session.set({ [H1B_ROLES_CACHE]: { names: names.join('\n'), rest: rest.join('\n') } });
      } catch {
        /* over quota — held in memory for this SW lifetime */
      }
    })();
  }
  await h1bRoleLoading;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'f2a-h1b-detail') return;
  if (sender.id !== chrome.runtime.id) return; // only our own contexts (consistency with sibling handlers)
  (async () => {
    try {
      await ensureH1bRoles();
      const q = normalizeCompanyName(String(msg.company ?? ''));
      sendResponse({ detail: mergeH1bRows(h1bRoleNames ?? [], h1bRoleRest ?? [], q) });
    } catch {
      sendResponse({ detail: null });
    }
  })();
  return true; // async response
});

// Bridge proxy: content script → SW → 127.0.0.1 (no per-site local-access prompt).
// The ONLY bridge methods the extension proxies. An allow-list here means a content-script XSS on a
// matched page can't reach arbitrary desktop RPC (e.g. exfiltrate the full profile) — only the calls
// the extension already makes. (finding #6)
const ALLOWED_BRIDGE_METHODS = new Set([
  'status',
  'keywords',
  'visa',
  'saveJob',
  'answer',
  'resumeFile',
  'tailoredResumeFile',
]);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'f2a-bridge') return;
  // Only our own extension's contexts may proxy to the bridge (belt-and-suspenders — there's no
  // externally_connectable), and only allow-listed methods.
  if (sender.id !== chrome.runtime.id) return;
  const method = String(msg.method);
  if (!ALLOWED_BRIDGE_METHODS.has(method)) {
    sendResponse({ error: `bridge method not allowed: ${method}` });
    return true;
  }
  (async () => {
    try {
      const conn = await loadConnection();
      if (!conn) {
        sendResponse({ error: 'not-connected' });
        return;
      }
      const result = await rpc(conn.port, conn.token, method, msg.params ?? {});
      sendResponse({ result });
    } catch (e) {
      sendResponse({ error: e instanceof Error ? e.message : 'bridge error' });
    }
  })();
  return true; // async response
});

// Standalone AI (BYO key): the content script sends a candidate brief + job + questions; WE hold the
// key (session storage) and call the provider directly, so no desktop app is needed and the key never
// enters the page/content world. Zero telemetry on this path (ADR-0009). Only our own contexts.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'f2a-ai' || (msg.method !== 'answers' && msg.method !== 'parseResume')) return;
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    try {
      const cfg = await getAiConfig();
      if (!cfg) {
        sendResponse({ error: 'no-key' });
        return;
      }
      if (msg.method === 'parseResume') {
        const p = (msg.params ?? {}) as { text?: string };
        const { parsed, usage } = await parseResumeToProfile(cfg, String(p.text ?? '').slice(0, 20_000));
        sendResponse({ result: { parsed, usage } });
        return;
      }
      const params = (msg.params ?? {}) as { context?: string; job?: Record<string, string>; questions?: string[] };
      const questions = Array.isArray(params.questions) ? params.questions.map(String).slice(0, 8) : [];
      const { answers, usage } = await draftAnswers(cfg, String(params.context ?? ''), params.job ?? {}, questions);
      sendResponse({ result: { answers, usage } });
    } catch (e) {
      sendResponse({ error: e instanceof Error ? e.message : 'ai error' });
    }
  })();
  return true; // async response
});

// Sign-in bridge: the auth content script on app.jobhakken.com forwards the signed-in identity (or
// null on sign-out). Only accept it from our own content script AND only from the web-app origin.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'f2a-auth') return;
  if (sender.id !== chrome.runtime.id) return;
  if (!sender.url || !sender.url.startsWith(WEB_APP_ORIGIN)) return; // must come from the web app
  (async () => {
    const id = msg.identity as Identity | null;
    if (id && typeof id.email === 'string' && id.email) {
      // Tier lives in profiles.subscription_tier (Stripe webhook), not the token metadata — fetch the
      // authoritative entitlement with the access token and let it win. Fails soft (keeps prior tier).
      if (id.accessToken) {
        const tier = await fetchEntitlement(id.accessToken);
        if (tier) id.tier = tier;
      }
      await saveIdentity(id);
    } else await clearIdentity();
    sendResponse({ ok: true });
  })();
  return true; // async response
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  // content script reports fillable-field count → remember which frame has the form + badge it.
  // (The popup + keyboard command read that frame back via frameStore to target it directly —
  // under all_frames a bare sendMessage would race the empty top frame.)
  if (msg?.type === 'f2a-detected') {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    if (typeof tabId === 'number' && typeof frameId === 'number') {
      const count = typeof msg.count === 'number' ? msg.count : 0;
      void recordFrameFields(tabId, frameId, count).then((best) => {
        // badge reflects the form-bearing frame (the one with the most fields), not whichever
        // frame reported last — so an embedded ATS in an iframe still shows its real count.
        const n = best?.count ?? 0;
        chrome.action.setBadgeBackgroundColor({ color: '#0f9d6b', tabId });
        chrome.action.setBadgeText({ tabId, text: n > 0 ? String(n) : '' });
        chrome.action.setTitle({ tabId, title: n > 0 ? `JobHakken — ${n} fillable field(s)` : 'JobHakken' });
      });
    }
    return;
  }
  if (msg?.type === 'f2a-open-options') void chrome.runtime.openOptionsPage();
});

// Forget a tab's frame map when it closes (keeps storage.session tidy).
chrome.tabs.onRemoved.addListener((tabId) => void clearTabFrames(tabId));

// Keyboard command → tell the active tab's FORM frame to autofill (frameId, not a broadcast).
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'autofill') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return;
    const frameId = await bestFrameId(tab.id);
    void chrome.tabs
      .sendMessage(tab.id, { type: 'f2a-run-autofill' }, frameId != null ? { frameId } : {})
      .catch(() => {});
  }
});
