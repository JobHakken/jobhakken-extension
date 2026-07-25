/**
 * Telemetry from non-service-worker contexts (content script, options, popup). The GA sink is
 * registered only in the service worker, so these forward a metadata-only event to it via a
 * `jh-telemetry` message; the SW's handler runs it through the allowlisted `track()`.
 */

/** Fire-and-forget: forward a metadata-only event to the service worker's telemetry sink. */
export function report(event: string, params: Record<string, string | number | boolean> = {}): void {
  try {
    void chrome.runtime.sendMessage({ type: 'jh-telemetry', event, params });
  } catch {
    /* telemetry must never break the UI */
  }
}

/** Coarse bucket for counts so analytics stays non-identifying. */
export function bucket(n: number): string {
  if (n <= 0) return '0';
  if (n <= 5) return '1-5';
  if (n <= 15) return '6-15';
  return '16+';
}
