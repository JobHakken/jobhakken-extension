import { createHmac } from 'crypto';

import { describe, expect, it } from '@jest/globals';

import { connect, discoverBridge, rpc, verifyHealthChallenge } from './bridgeClient';

/** The mac the genuine desktop app would return: HMAC-SHA256(token, 'jh-health:' + nonce). */
const macFor = (token: string, nonce: string) =>
  createHmac('sha256', token)
    .update('jh-health:' + nonce)
    .digest('hex');

/** A fake fetch: /health answers only on `livePort`; /rpc checks the bearer token. */
function makeFetch(livePort: number, validToken: string): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/health')) {
      if (!u.includes(`:${livePort}/`)) throw new Error('ECONNREFUSED');
      return { ok: true, status: 200, json: async () => ({ ok: true, name: 'jobhakken' }) } as unknown as Response;
    }
    if (u.endsWith('/rpc')) {
      const auth = (init?.headers as Record<string, string>)?.authorization ?? '';
      if (auth !== `Bearer ${validToken}`) {
        return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { hasResume: true, basics: { name: 'Pranav' } } }),
      } as unknown as Response;
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
}

const PORTS = [41573, 41574, 41575];

describe('bridgeClient (Phase 7.1)', () => {
  it('discovers the bridge by probing candidate ports', async () => {
    const found = await discoverBridge({ fetchImpl: makeFetch(41575, 't'), ports: PORTS });
    expect(found?.port).toBe(41575);
    expect(found?.health).toMatchObject({ name: 'jobhakken' });
  });

  it('returns null when no port answers', async () => {
    const dead = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await discoverBridge({ fetchImpl: dead, ports: PORTS })).toBeNull();
  });

  it('rpc sends the bearer token and unwraps result', async () => {
    const res = await rpc<{ hasResume: boolean }>(
      41575,
      'good',
      'profile',
      {},
      { fetchImpl: makeFetch(41575, 'good') },
    );
    expect(res.hasResume).toBe(true);
  });

  it('rpc throws on a non-ok response', async () => {
    await expect(rpc(41575, 'bad', 'profile', {}, { fetchImpl: makeFetch(41575, 'good') })).rejects.toThrow(
      /unauthorized|failed/i,
    );
  });

  it('connect discovers + verifies the token + returns the profile', async () => {
    const conn = await connect('good', { fetchImpl: makeFetch(41575, 'good'), ports: PORTS });
    expect(conn.port).toBe(41575);
    expect(conn.profile.basics?.name).toBe('Pranav');
  });

  it('connect rejects a bad token with a friendly message', async () => {
    await expect(connect('wrong', { fetchImpl: makeFetch(41575, 'good'), ports: PORTS })).rejects.toThrow(
      /rejected|token/i,
    );
  });

  it('connect requires a token', async () => {
    await expect(connect('  ', { fetchImpl: makeFetch(41575, 'good'), ports: PORTS })).rejects.toThrow(/token/i);
  });

  it('connect errors clearly when the app is not running', async () => {
    const dead = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(connect('good', { fetchImpl: dead, ports: PORTS })).rejects.toThrow(/not found|Open it/i);
  });
});

describe('verifyHealthChallenge (#1 — bridge identity)', () => {
  it("returns 'ok' when the mac proves the server holds the token", async () => {
    const nonce = 'abc123';
    expect(await verifyHealthChallenge('tok', { name: 'jobhakken', nonce, mac: macFor('tok', nonce) })).toBe('ok');
  });
  it("returns 'reject' when the mac is wrong (rogue that doesn't know the token)", async () => {
    expect(
      await verifyHealthChallenge('tok', { name: 'jobhakken', nonce: 'abc123', mac: macFor('WRONG-TOKEN', 'abc123') }),
    ).toBe('reject');
  });
  it("returns 'legacy' when /health carries no challenge (older app)", async () => {
    expect(await verifyHealthChallenge('tok', { name: 'jobhakken' })).toBe('legacy');
  });
});

describe('connect (#1 — impersonation)', () => {
  // A rogue that echoes name + a nonce, but a mac it can't compute (doesn't know the token).
  const rogueFetch = (port: number): typeof fetch =>
    (async (url: string) => {
      const u = String(url);
      if (u.endsWith('/health')) {
        if (!u.includes(`:${port}/`)) throw new Error('ECONNREFUSED');
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, name: 'jobhakken', nonce: 'n1', mac: macFor('not-the-token', 'n1') }),
        } as unknown as Response;
      }
      if (u.endsWith('/rpc')) throw new Error('SECURITY: token must never be sent to a rogue');
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

  // A genuine app that returns a valid mac and checks the bearer.
  const genuineFetch = (port: number, token: string): typeof fetch =>
    (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/health')) {
        if (!u.includes(`:${port}/`)) throw new Error('ECONNREFUSED');
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, name: 'jobhakken', nonce: 'n2', mac: macFor(token, 'n2') }),
        } as unknown as Response;
      }
      if (u.endsWith('/rpc')) {
        const auth = (init?.headers as Record<string, string>)?.authorization ?? '';
        if (auth !== `Bearer ${token}`)
          return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) } as unknown as Response;
        return { ok: true, status: 200, json: async () => ({ result: { hasResume: true } }) } as unknown as Response;
      }
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

  it('refuses to connect (never sending the token) when the identity challenge fails', async () => {
    await expect(connect('good', { fetchImpl: rogueFetch(41575), ports: PORTS })).rejects.toThrow(/impersonating/i);
  });

  it('connects to a genuine app that passes the challenge', async () => {
    const conn = await connect('good', { fetchImpl: genuineFetch(41575, 'good'), ports: PORTS });
    expect(conn.port).toBe(41575);
  });
});
