import { beforeEach, describe, expect, it } from '@jest/globals';

import { clearIdentity, loadIdentity, parseSupabaseSession, saveIdentity } from './authStore';

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
