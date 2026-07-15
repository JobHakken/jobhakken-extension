/**
 * MV3 background service worker (Phase 7.2). Owns the toolbar badge (the "ON"
 * indicator) and routes the autofill trigger to the active tab's content script.
 * Ephemeral — holds no in-memory state.
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`First2Apply extension installed (${details.reason}).`);
});

// Content script reports how many fillable fields it found → badge shows it's ON.
chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (msg?.type === 'f2a-detected' && typeof tabId === 'number') {
    const count = typeof msg.count === 'number' ? msg.count : 0;
    chrome.action.setBadgeBackgroundColor({ color: '#0f9d6b', tabId });
    chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
    chrome.action.setTitle({ tabId, title: count > 0 ? `First2Apply — ${count} fillable field(s)` : 'First2Apply' });
  }
});

// Toolbar click or keyboard command → tell the tab's content script to autofill.
function triggerAutofill(tabId?: number) {
  if (typeof tabId === 'number') void chrome.tabs.sendMessage(tabId, { type: 'f2a-run-autofill' }).catch(() => {});
}

chrome.action.onClicked.addListener((tab) => triggerAutofill(tab.id));

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'autofill') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    triggerAutofill(tab?.id);
  }
});
