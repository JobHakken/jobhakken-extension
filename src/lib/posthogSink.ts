/**
 * PostHog sink (#106) — dual-sinks the SAME metadata-only telemetry as gaSink to the SAME PostHog
 * project the webapp + marketing site already use, so extension and web usage land in one place
 * (the "first-party sink" from #43). It registers as a second `TelemetrySink` alongside GA, so it
 * inherits the opt-out toggle and the allowlist: only sanitized, allowlisted params ever reach it.
 *
 * MV3 can't use `posthog-js` (a DOM/autocapture browser lib — wrong fit for a service worker + CSP),
 * so we POST directly to PostHog's HTTP capture API, the same lightweight direct-`fetch` shape as
 * gaSink. Cookieless / anonymous: `distinct_id` is the per-install anon `jh_client_id`, and
 * `$process_person_profile: false` tells PostHog never to build a person profile.
 *
 * Host: we POST to `app.jobhakken.com/ingest` — a PostHog reverse-proxy on an origin that is ALREADY
 * in `host_permissions`, so there's no new permission (→ no update re-prompt) and adblockers that
 * block `*.posthog.com` don't hit us. The webapp must forward `/ingest/*` → the PostHog host (needs:web).
 * The project key is injected at BUILD time (release only), like `GA_API_SECRET` — absent in dev/CI, so
 * the sink stays inert there and nothing leaves the machine.
 */
import { registerSink, type TelemetryPayload, type TelemetrySink } from './telemetry.js';

/**
 * PostHog capture endpoint via our own reverse-proxy on the already-permitted origin. The webapp
 * proxies `/ingest/*` to the PostHog ingestion host; `/ingest/capture/` is PostHog's capture route.
 */
export const POSTHOG_INGEST_URL = 'https://app.jobhakken.com/ingest/capture/';

// Replaced by esbuild `define` at build time (build.mjs); `typeof` guard keeps it safe under jest.
declare const __POSTHOG_KEY__: string;

/** Build a PostHog HTTP-capture sink. Pure + testable (inject fetch). */
export function makePosthogSink(
  apiKey: string,
  url: string = POSTHOG_INGEST_URL,
  fetchImpl: typeof fetch = fetch,
): TelemetrySink {
  return async (p: TelemetryPayload) => {
    const body = {
      api_key: apiKey,
      event: p.event,
      distinct_id: p.client_id, // anon per-install id — never a person
      timestamp: new Date(p.ts).toISOString(),
      properties: {
        ...p.params, // already sanitized to the allowlist upstream — no content ever
        ext_version: p.ext_version,
        $process_person_profile: false, // cookieless: never build a person profile
      },
    };
    await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    });
  };
}

/** Register the PostHog sink IFF the project key was injected at build time. Returns whether it registered. */
export function initPosthogSink(fetchImpl?: typeof fetch): boolean {
  const key = typeof __POSTHOG_KEY__ !== 'undefined' ? __POSTHOG_KEY__ : '';
  if (!key) return false; // dev/CI build → inert
  registerSink(makePosthogSink(key, POSTHOG_INGEST_URL, fetchImpl));
  return true;
}
