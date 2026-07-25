/**
 * GA4 Measurement Protocol sink for the telemetry core (issue #43, option A).
 *
 * MV3 can't use gtag.js (remote code, blocked by CSP), so we POST events to the Measurement
 * Protocol from the service worker. The measurement id is public; the API secret is injected at
 * BUILD time from the GA_API_SECRET repo secret (see build.mjs) — absent in dev/CI builds, so the
 * sink stays inert there and nothing leaves the machine.
 */
import { registerSink, type TelemetryPayload, type TelemetrySink } from './telemetry.js';

// Dedicated GA4 property for the extension (separate from the CWS store-listing property).
export const GA_MEASUREMENT_ID = 'G-WSHEGRCT06';

// Replaced by esbuild `define` at build time; `typeof` guard keeps it safe under jest (undefined).
declare const __GA_API_SECRET__: string;

/** Build a GA4 Measurement Protocol sink. Pure + testable (inject fetch). */
export function makeGaSink(measurementId: string, apiSecret: string, fetchImpl: typeof fetch = fetch): TelemetrySink {
  const url =
    `https://www.google-analytics.com/mp/collect` +
    `?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  return async (p: TelemetryPayload) => {
    const body = {
      client_id: p.client_id,
      events: [
        {
          name: p.event,
          // Only the already-sanitized allowlisted params + version reach GA. No content.
          params: { ...p.params, ext_version: p.ext_version, engagement_time_msec: 1 },
        },
      ],
    };
    await fetchImpl(url, { method: 'POST', body: JSON.stringify(body), keepalive: true });
  };
}

/** Register the GA sink IFF the API secret was injected at build time. Returns whether it registered. */
export function initGaSink(fetchImpl?: typeof fetch): boolean {
  const secret = typeof __GA_API_SECRET__ !== 'undefined' ? __GA_API_SECRET__ : '';
  if (!secret) return false; // dev/CI build → inert
  registerSink(makeGaSink(GA_MEASUREMENT_ID, secret, fetchImpl));
  return true;
}
