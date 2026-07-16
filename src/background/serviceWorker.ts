/**
 * MV3 background service worker (Phase 7.2/7.3). Owns the toolbar badge (the "ON"
 * indicator), opens Options on request, routes the autofill trigger (keyboard command)
 * to the active tab, and — crucially — PROXIES all desktop-bridge calls. Bridge fetches
 * hit http://127.0.0.1; from a content script (page origin) the browser prompts the site
 * for local-device access on every page, so the content script messages us instead and
 * WE fetch (extension origin + host_permissions → no prompt). Ephemeral — no state.
 */
import { rpc } from '../lib/bridgeClient.js';
import { loadConnection } from '../lib/connectionStore.js';

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`First2Apply extension installed (${details.reason}).`);
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
