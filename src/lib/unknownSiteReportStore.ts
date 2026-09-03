/**
 * Dedup for the "unknown job site" report opened from the rail launcher (#N — icon-everywhere +
 * report-unrecognized-sites). Distinct from `f2a_site_seen` in popup.ts's `reportSiteCandidate`:
 * that one covers pages where NO content script ran at all (silent, hashed-host telemetry only,
 * never a GitHub issue). This one covers pages where the rail DID mount — via the field-count
 * fallback rather than a recognized host — and the person actually clicked the launcher. Different
 * population, different action (a real, page-derived GitHub issue draft), so a separate key rather
 * than reusing that map.
 *
 * Same 7-day-per-host, capped-at-200 shape as the existing dedup, so clicking the launcher
 * repeatedly on the same unsupported site during one visit — or across a week of revisits — opens
 * at most one report draft.
 */
const SEEN = 'f2a_unknown_site_seen';
const WINDOW_MS = 7 * 864e5;
const MAX = 200;

export async function shouldReportUnknownSite(host: string): Promise<boolean> {
  const store = ((await chrome.storage.local.get(SEEN))[SEEN] as Record<string, number>) ?? {};
  const last = store[host];
  return !last || Date.now() - last >= WINDOW_MS;
}

export async function markUnknownSiteReported(host: string): Promise<void> {
  const store = ((await chrome.storage.local.get(SEEN))[SEEN] as Record<string, number>) ?? {};
  store[host] = Date.now();
  const kept = Object.fromEntries(
    Object.entries(store)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX),
  );
  await chrome.storage.local.set({ [SEEN]: kept });
}
