import { describe, expect, it, jest } from '@jest/globals';

import { initPosthogSink, makePosthogSink, POSTHOG_INGEST_URL } from './posthogSink';
import type { TelemetryPayload } from './telemetry';

const payload: TelemetryPayload = {
  event: 'autofill_run',
  params: { ok: true, ats_platform: 'greenhouse', missed_types: 'salary,work_auth' },
  client_id: 'anon-123',
  ext_version: '0.23.1',
  ts: 1_700_000_000_000,
};

describe('makePosthogSink', () => {
  it('POSTs a cookieless PostHog capture with only allowlisted params', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;

    const sink = makePosthogSink('phc_test', POSTHOG_INGEST_URL, fetchImpl);
    await sink(payload);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(POSTHOG_INGEST_URL);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.api_key).toBe('phc_test');
    expect(body.event).toBe('autofill_run');
    expect(body.distinct_id).toBe('anon-123'); // anon per-install id, never a person
    expect(body.timestamp).toBe('2023-11-14T22:13:20.000Z'); // derived from payload.ts
    expect(body.properties.$process_person_profile).toBe(false); // cookieless
    expect(body.properties.ats_platform).toBe('greenhouse');
    expect(body.properties.missed_types).toBe('salary,work_auth');
    expect(body.properties.ext_version).toBe('0.23.1');
    // No content keys — the payload only ever carries the sanitized allowlist.
    expect(Object.keys(body.properties)).not.toContain('url');
    expect(Object.keys(body.properties)).not.toContain('company');
  });

  it('targets our already-permitted reverse-proxy origin (no *.posthog.com)', () => {
    expect(POSTHOG_INGEST_URL.startsWith('https://app.jobhakken.com/')).toBe(true);
    expect(POSTHOG_INGEST_URL).not.toContain('posthog.com');
  });
});

describe('initPosthogSink', () => {
  it('is inert (registers nothing) when no key was built in', () => {
    // __POSTHOG_KEY__ is undefined under jest (no esbuild define) → the guard returns false.
    expect(initPosthogSink(jest.fn() as unknown as typeof fetch)).toBe(false);
  });
});
