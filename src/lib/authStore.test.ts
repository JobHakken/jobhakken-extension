import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  clearIdentity,
  fetchEntitlement,
  loadIdentity,
  parseSupabaseCookies,
  parseSupabaseSession,
  saveIdentity,
} from './authStore';

const mem: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(mem)) delete mem[k];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: mem[k] }),
        set: async (o: Record<string, unknown>) => Object.assign(mem, o),
        remove: async (k: string) => delete mem[k],
      },
    },
  };
});

describe('parseSupabaseSession', () => {
  it('reads the supabase-js v2 (flat) shape and drops the refresh token', () => {
    const raw = JSON.stringify({
      access_token: 'at',
      refresh_token: 'rt-SECRET',
      expires_at: 1893456000,
      user: { id: 'u1', email: 'jordan@example.com', app_metadata: { tier: 'pro' } },
    });
    const id = parseSupabaseSession(raw);
    expect(id).toEqual({
      email: 'jordan@example.com',
      userId: 'u1',
      tier: 'pro',
      accessToken: 'at',
      expiresAt: 1893456000,
    });
    expect(JSON.stringify(id)).not.toContain('rt-SECRET'); // refresh token never stored
  });

  it('reads the v1 { currentSession } wrapper', () => {
    const raw = JSON.stringify({ currentSession: { access_token: 'at', user: { id: 'u2', email: 'a@b.com' } } });
    expect(parseSupabaseSession(raw)?.email).toBe('a@b.com');
  });

  it('returns null for signed-out / malformed / no email', () => {
    expect(parseSupabaseSession('null')).toBeNull();
    expect(parseSupabaseSession('not json')).toBeNull();
    expect(parseSupabaseSession(JSON.stringify({ user: { id: 'x' } }))).toBeNull();
  });
});

describe('identity store', () => {
  it('saves, loads, and clears identity', async () => {
    expect(await loadIdentity()).toBeNull();
    await saveIdentity({ email: 'j@example.com', userId: 'u1', tier: 'plus' });
    expect((await loadIdentity())?.email).toBe('j@example.com');
    await clearIdentity();
    expect(await loadIdentity()).toBeNull();
  });
});

describe('parseSupabaseCookies (@supabase/ssr session cookies)', () => {
  const session = {
    access_token: 'at-123',
    refresh_token: 'rt-SECRET',
    expires_at: 1893456000,
    user: { id: 'u1', email: 'jordan@example.com', app_metadata: { tier: 'pro' } },
  };
  const b64 = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');

  it('reads a single (unchunked) base64 auth-token cookie', () => {
    const id = parseSupabaseCookies(`sb-abcdef-auth-token=${b64}`);
    expect(id).toMatchObject({ email: 'jordan@example.com', tier: 'pro', accessToken: 'at-123' });
    expect(id).not.toHaveProperty('refresh_token');
  });

  it('reassembles CHUNKED cookies in order and base64-decodes', () => {
    const mid = Math.floor(b64.length / 2);
    const c0 = b64.slice(0, mid);
    const c1 = b64.slice(mid);
    // deliberately list .1 before .0 to prove ordering is by index, not cookie order
    const cookie = `other=x; sb-abcdef-auth-token.1=${c1}; sb-abcdef-auth-token.0=${c0}`;
    const id = parseSupabaseCookies(cookie);
    expect(id).toMatchObject({ email: 'jordan@example.com', tier: 'pro', accessToken: 'at-123' });
  });

  it('handles legacy raw-JSON cookie value (no base64- prefix)', () => {
    const raw = encodeURIComponent(JSON.stringify(session));
    expect(parseSupabaseCookies(`sb-xyz-auth-token=${raw}`)).toMatchObject({ email: 'jordan@example.com' });
  });

  it('returns null when there is no auth-token cookie (signed out)', () => {
    expect(parseSupabaseCookies('theme=dark; other=1')).toBeNull();
    expect(parseSupabaseCookies('')).toBeNull();
  });

  it('ignores unrelated sb cookies and malformed values', () => {
    expect(parseSupabaseCookies('sb-abcdef-auth-token=base64-not$$valid')).toBeNull();
    expect(parseSupabaseCookies('sb-provider-token=whatever')).toBeNull();
  });
});

describe('fetchEntitlement', () => {
  const setFetch = (impl: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>) => {
    const spy = jest.fn(impl);
    (globalThis as unknown as { fetch: unknown }).fetch = spy;
    return spy;
  };
  const ok = (tier: unknown) => () => Promise.resolve({ ok: true, json: () => Promise.resolve({ tier }) });

  it('returns the tier from a 200 response and sends a Bearer token', async () => {
    const spy = setFetch(ok('pro'));
    expect(await fetchEntitlement('at-123')).toBe('pro');
    const [url, init] = spy.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toContain('/api/entitlement');
    expect(init.headers.Authorization).toBe('Bearer at-123');
  });

  it('returns undefined on a non-ok response (e.g. 401)', async () => {
    setFetch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    expect(await fetchEntitlement('at')).toBeUndefined();
  });

  it('returns undefined on network error, missing/non-string tier, or empty token', async () => {
    setFetch(() => Promise.reject(new Error('offline')));
    expect(await fetchEntitlement('at')).toBeUndefined();
    setFetch(ok(undefined));
    expect(await fetchEntitlement('at')).toBeUndefined();
    expect(await fetchEntitlement('')).toBeUndefined();
  });
});
