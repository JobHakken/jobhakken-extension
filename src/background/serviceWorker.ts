/**
 * MV3 background service worker (Phase 7.2/7.3). Owns the toolbar badge (the "ON"
 * indicator), opens Options on request, routes the autofill trigger (keyboard command)
 * to the active tab, and — crucially — PROXIES all desktop-bridge calls. Bridge fetches
 * hit http://127.0.0.1; from a content script (page origin) the browser prompts the site
 * for local-device access on every page, so the content script messages us instead and
 * WE fetch (extension origin + host_permissions → no prompt). Ephemeral — no state.
 */
import { normalizeCompanyName } from '@first2apply/core/build/sponsors';

import { rpc } from '../lib/bridgeClient.js';
import { loadConnection } from '../lib/connectionStore.js';

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`First2Apply extension installed (${details.reason}).`);
});

// ── H-1B sponsor lookup (bundled, standalone) ──────────────────────────────
// Loaded once from the packaged compact list (normalizedName \t approvals, sorted). Matching
// sums a company's exact + word-prefix entries ("emerson" → "emerson electric" + …) so a
// LinkedIn brand name resolves to the sum across its legal entities, mirroring the desktop.
let h1bNames: string[] | null = null;
let h1bApprovals: Int32Array | null = null;
let h1bLoading: Promise<void> | null = null;

async function ensureH1b(): Promise<void> {
  if (h1bNames) return;
  if (!h1bLoading) {
    h1bLoading = (async () => {
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'f2a-h1b') return;
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

// Bridge proxy: content script → SW → 127.0.0.1 (no per-site local-access prompt).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'f2a-bridge') return;
  (async () => {
    try {
      const conn = await loadConnection();
      if (!conn) {
        sendResponse({ error: 'not-connected' });
        return;
      }
      const result = await rpc(conn.port, conn.token, String(msg.method), msg.params ?? {});
      sendResponse({ result });
    } catch (e) {
      sendResponse({ error: e instanceof Error ? e.message : 'bridge error' });
    }
  })();
  return true; // async response
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  // content script reports fillable-field count → badge shows the extension is ON
  if (msg?.type === 'f2a-detected') {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      const count = typeof msg.count === 'number' ? msg.count : 0;
      chrome.action.setBadgeBackgroundColor({ color: '#0f9d6b', tabId });
      chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
      chrome.action.setTitle({ tabId, title: count > 0 ? `First2Apply — ${count} fillable field(s)` : 'First2Apply' });
    }
    return;
  }
  if (msg?.type === 'f2a-open-options') void chrome.runtime.openOptionsPage();
});

// Keyboard command → tell the active tab's content script to autofill.
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'autofill') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) void chrome.tabs.sendMessage(tab.id, { type: 'f2a-run-autofill' }).catch(() => {});
  }
});
