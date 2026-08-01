import { createHmac } from 'crypto';

import { describe, expect, it } from '@jest/globals';

import { connect, discoverBridge, performHandshake, rpc } from './bridgeClient';

/** The mac the genuine app returns: base64(HMAC-SHA256(token, nonce)) — mirrors the desktop's
 *  `computeHandshakeMac` (#283). */
const macFor = (token: string, nonce: string) => createHmac('sha256', token).update(nonce).digest('base64');

/**
 * A fake loopback bridge. `/health` advertises the handshake capability (unless `handshakeCap:false`
 * models a legacy app); `/handshake` proves `serverToken` against the client's nonce; `/rpc` checks the
 * bearer against `serverToken`. Set `serverToken` ≠ the client token to model a ROGUE that won name-
 * only discovery but doesn't know the real token. `onRpc` fires if /rpc is ever hit (token leak check).
 */
function makeBridge(opts: { livePort: number; serverToken: string; handshakeCap?: boolean; onRpc?: () => void }) {
  const { livePort, serverToken, handshakeCap = true, onRpc } = opts;
  return (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes(`:${livePort}/`)) throw new Error('ECONNREFUSED');
    if (u.endsWith('/health')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          name: 'jobhakken',
          ...(handshakeCap ? { capabilities: { handshake: true } } : {}),
        }),
      } as unknown as Response;
    }
    if (u.endsWith('/handshake')) {
      const { nonce } = JSON.parse(String(init?.body ?? '{}')) as { nonce: string };
      return { ok: true, status: 200, json: async () => ({ mac: macFor(serverToken, nonce) }) } as unknown as Response;
    }
    if (u.endsWith('/rpc')) {
      onRpc?.();
      const auth = (init?.headers as Record<string, string>)?.authorization ?? '';
      if (auth !== `Bearer ${serverToken}`) {
        return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { hasResume: true, basics: { name: 'Jordan Rivera' } } }),
      } as unknown as Response;
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
}

const dead = (async () => {
  throw new Error('ECONNREFUSED');
}) as unknown as typeof fetch;

const PORTS = [41573, 41574, 41575];

describe('bridgeClient discovery + rpc', () => {
  it('discovers the bridge by probing candidate ports', async () => {
    const found = await discoverBridge({ fetchImpl: makeBridge({ livePort: 41575, serverToken: 't' }), ports: PORTS });
    expect(found?.port).toBe(41575);
    expect(found?.health).toMatchObject({ name: 'jobhakken', capabilities: { handshake: true } });
  });

  it('returns null when no port answers', async () => {
    expect(await discoverBridge({ fetchImpl: dead, ports: PORTS })).toBeNull();
  });

  it('rpc sends the bearer token and unwraps result', async () => {
    const res = await rpc<{ hasResume: boolean }>(
      41575,
      'good',
      'profile',
      {},
      { fetchImpl: makeBridge({ livePort: 41575, serverToken: 'good' }) },
    );
    expect(res.hasResume).toBe(true);
  });

  it('rpc throws on a non-ok response', async () => {
    await expect(
      rpc(41575, 'bad', 'profile', {}, { fetchImpl: makeBridge({ livePort: 41575, serverToken: 'good' }) }),
    ).rejects.toThrow(/unauthorized|failed/i);
  });
});

describe('performHandshake (#1/#283 — prove the server holds the token, without sending it)', () => {
  it('returns true when the mac verifies (genuine app)', async () => {
    expect(
      await performHandshake('good', 41575, { fetchImpl: makeBridge({ livePort: 41575, serverToken: 'good' }) }),
    ).toBe(true);
  });

  it('returns false when the mac is wrong (rogue that does not know the token)', async () => {
    expect(
      await performHandshake('good', 41575, { fetchImpl: makeBridge({ livePort: 41575, serverToken: 'rogue' }) }),
    ).toBe(false);
  });

  it('returns false when /handshake is unreachable', async () => {
    expect(await performHandshake('good', 41575, { fetchImpl: dead })).toBe(false);
  });
});

describe('connect (#1 — handshake gating)', () => {
  it('connects to a genuine app that passes the handshake', async () => {
    const conn = await connect('good', {
      fetchImpl: makeBridge({ livePort: 41575, serverToken: 'good' }),
      ports: PORTS,
    });
    expect(conn.port).toBe(41575);
    expect(conn.profile.basics?.name).toBe('Jordan Rivera');
  });

  it('refuses a rogue (handshake fails) and NEVER sends the token to /rpc', async () => {
    let rpcCalled = false;
    const fetchImpl = makeBridge({
      livePort: 41575,
      serverToken: 'rogue',
      onRpc: () => {
        rpcCalled = true;
      },
    });
    await expect(connect('good', { fetchImpl, ports: PORTS })).rejects.toThrow(/impersonating/i);
    expect(rpcCalled).toBe(false); // the token must never reach a server that failed the handshake
  });

  it('connects to a legacy app that does not advertise the handshake (no proof required)', async () => {
    const conn = await connect('good', {
      fetchImpl: makeBridge({ livePort: 41575, serverToken: 'good', handshakeCap: false }),
      ports: PORTS,
    });
    expect(conn.port).toBe(41575);
  });

  it('requires a token', async () => {
    await expect(
      connect('  ', { fetchImpl: makeBridge({ livePort: 41575, serverToken: 'good' }), ports: PORTS }),
    ).rejects.toThrow(/token/i);
  });

  it('errors clearly when the app is not running', async () => {
    await expect(connect('good', { fetchImpl: dead, ports: PORTS })).rejects.toThrow(/not found|Open it/i);
  });

  it('a wrong token on a legacy app is rejected at /rpc with a friendly message', async () => {
    const fetchImpl = makeBridge({ livePort: 41575, serverToken: 'real', handshakeCap: false });
    await expect(connect('wrong', { fetchImpl, ports: PORTS })).rejects.toThrow(/rejected|token/i);
  });
});
