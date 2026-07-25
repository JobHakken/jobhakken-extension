/**
 * @jest-environment node
 *
 * Telemetry allowlist + opt-out. The whole point is that content can never leak, so most tests
 * assert that disallowed events/params are dropped.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { _resetSinks, registerSink, sanitize, setTelemetryEnabled, track, type TelemetryPayload } from './telemetry';

// Minimal chrome.storage.local mock backed by a plain object.
function mockChrome(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
      },
    },
    runtime: { getManifest: () => ({ version: '9.9.9' }) },
  };
  return store;
}

describe('telemetry.sanitize', () => {
  it('drops an event that is not on the allowlist', () => {
    expect(sanitize('totally_made_up', { ok: true })).toBeNull();
  });

  it('keeps allowlisted params and STRIPS content-bearing ones', () => {
    const out = sanitize('autofill_run', {
      ok: true,
      fields_filled: '6-15',
      // none of these are allowlisted → must be stripped:
      resume: 'Jordan Rivera — Senior Engineer …',
      email: 'jordan@example.com',
      url: 'https://acme.example/apply',
      company: 'Acme',
    } as Record<string, string | number | boolean>);
    expect(out).not.toBeNull();
    expect(out!.params).toEqual({ ok: true, fields_filled: '6-15' });
  });
});

describe('telemetry.track', () => {
  beforeEach(() => _resetSinks());
  afterEach(() => _resetSinks());

  it('does nothing when there is no sink (inert)', async () => {
    mockChrome();
    await expect(track('autofill_run', { ok: true })).resolves.toBeUndefined();
  });

  it('dispatches a sanitized payload with client_id + ext_version', async () => {
    mockChrome();
    const seen: TelemetryPayload[] = [];
    registerSink((p) => void seen.push(p));
    await track('match_scored', { ok: true, resume: 'SECRET' } as Record<string, string | number | boolean>);
    expect(seen).toHaveLength(1);
    expect(seen[0].event).toBe('match_scored');
    expect(seen[0].params).toEqual({ ok: true }); // resume stripped
    expect(seen[0].ext_version).toBe('9.9.9');
    expect(typeof seen[0].client_id).toBe('string');
    expect(seen[0].client_id.length).toBeGreaterThan(0);
  });

  it('reuses a stable client_id across calls', async () => {
    mockChrome();
    const ids: string[] = [];
    registerSink((p) => void ids.push(p.client_id));
    await track('bridge_connected', { ok: true });
    await track('bridge_connected', { ok: true });
    expect(ids[0]).toBe(ids[1]);
  });

  it('respects opt-out (disabled → no sink call)', async () => {
    mockChrome({ jh_telemetry_enabled: false });
    let called = 0;
    registerSink(() => void called++);
    await track('autofill_run', { ok: true });
    expect(called).toBe(0);
  });

  it('re-enables after setTelemetryEnabled(true)', async () => {
    mockChrome({ jh_telemetry_enabled: false });
    let called = 0;
    registerSink(() => void called++);
    await setTelemetryEnabled(true);
    await track('autofill_run', { ok: true });
    expect(called).toBe(1);
  });

  it('never throws when a sink throws', async () => {
    mockChrome();
    registerSink(() => {
      throw new Error('sink boom');
    });
    await expect(track('error', { area: 'bridge', category: 'timeout' })).resolves.toBeUndefined();
  });
});
