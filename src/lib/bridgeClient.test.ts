import { describe, expect, it } from '@jest/globals';

import { connect, discoverBridge, rpc } from './bridgeClient';

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
      return { ok: true, status: 200, json: async () => ({ result: { hasResume: true, basics: { name: 'Pranav' } } }) } as unknown as Response;
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
}

const PORTS = [41573, 41574, 41575];

describe('bridgeClient (Phase 7.1)', () => {
  it('discovers the bridge by probing candidate ports', async () => {
    const found = await discoverBridge({ fetchImpl: makeFetch(41575, 't'), ports: PORTS });
    expect(found).toEqual({ port: 41575 });
  });

  it('returns null when no port answers', async () => {
    const dead = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await discoverBridge({ fetchImpl: dead, ports: PORTS })).toBeNull();
  });

  it('rpc sends the bearer token and unwraps result', async () => {
    const res = await rpc<{ hasResume: boolean }>(41575, 'good', 'profile', {}, { fetchImpl: makeFetch(41575, 'good') });
    expect(res.hasResume).toBe(true);
  });

  it('rpc throws on a non-ok response', async () => {
    await expect(rpc(41575, 'bad', 'profile', {}, { fetchImpl: makeFetch(41575, 'good') })).rejects.toThrow(/unauthorized|failed/i);
  });

  it('connect discovers + verifies the token + returns the profile', async () => {
    const conn = await connect('good', { fetchImpl: makeFetch(41575, 'good'), ports: PORTS });
    expect(conn.port).toBe(41575);
    expect(conn.profile.basics?.name).toBe('Pranav');
  });

  it('connect rejects a bad token with a friendly message', async () => {
    await expect(connect('wrong', { fetchImpl: makeFetch(41575, 'good'), ports: PORTS })).rejects.toThrow(/rejected|token/i);
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
