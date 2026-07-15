/**
 * MV3 background service worker (Phase 7.2/7.3). Owns the toolbar badge (the "ON"
 * indicator), opens Options on request, and routes the autofill trigger (keyboard
 * command) to the active tab. The toolbar click opens the popup. Ephemeral — no
 * in-memory state.
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`First2Apply extension installed (${details.reason}).`);
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
