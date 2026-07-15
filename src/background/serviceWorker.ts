/**
 * MV3 background service worker (Phase 7.1). Minimal for now — it just marks the
 * install. Later slices route content-script AI requests through the bridge and
 * refresh the cached profile here. (Service workers are ephemeral in MV3; keep no
 * in-memory state — everything durable lives in chrome.storage.)
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`First2Apply extension installed (${details.reason}).`);
});
