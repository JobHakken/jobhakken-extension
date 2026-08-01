/**
 * Talks to the JobHakken desktop app's loopback bridge (Phase 7.0). The bridge
 * binds one of a small candidate-port range on 127.0.0.1, so we discover it by
 * probing /health, then call the token-guarded /rpc surface.
 *
 * `fetchImpl` is injectable so the discovery/RPC logic is unit-testable.
 */

// Must match the candidate list the desktop bridge binds (extensionBridge.ts).
export const CANDIDATE_PORTS = [41573, 41574, 41575, 41576, 41577];

// Cap bridge responses so a rogue/buggy local server can't OOM/stall the worker with a huge body (#8).
// Résumé PDFs (base64) are a few MB; /health is tiny.
const MAX_RPC_BYTES = 50 * 1024 * 1024;
const MAX_HEALTH_BYTES = 64 * 1024;
function assertBodySize(res: Response, max: number): void {
  const len = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(len) && len > max) throw new Error(`bridge response too large: ${len} bytes`);
}

export type BridgeProfile = {
  hasResume: boolean;
  basics?: { name?: string; email?: string; phone?: string; location?: string };
  resumeText?: string;
};

export type BridgeConnection = { port: number; token: string; profile: BridgeProfile };

type Opts = { fetchImpl?: typeof fetch; ports?: number[]; timeoutMs?: number };

// The genuine desktop app answers /health with an identity challenge: a random `nonce` plus
// `mac = HMAC-SHA256(connection-token, 'jh-health:' + nonce)`. Only a server that knows the token
// (the one the user pasted from the app) can produce a valid mac — so we can reject a rogue localhost
// server that merely echoes name:'jobhakken' BEFORE handing it the token or any RPC content (#1).
export type BridgeHealth = { name?: string; nonce?: unknown; mac?: unknown };

/** fetch with an AbortController timeout so a hung/crashed desktop app can't stall us forever. */
async function fetchWithTimeout(f: typeof fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await f(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Find the desktop bridge by probing /health across the candidate ports (returns its health body). */
export async function discoverBridge(opts: Opts = {}): Promise<{ port: number; health: BridgeHealth } | null> {
  const f = opts.fetchImpl ?? fetch;
  for (const port of opts.ports ?? CANDIDATE_PORTS) {
    try {
      const res = await fetchWithTimeout(f, `http://127.0.0.1:${port}/health`, {}, opts.timeoutMs ?? 1500);
      if (!res.ok) continue;
      assertBodySize(res, MAX_HEALTH_BYTES);
      const body = (await res.json()) as BridgeHealth;
      if (body?.name === 'jobhakken') return { port, health: body };
    } catch {
      /* nothing listening (or timed out) — try the next port */
    }
  }
  return null;
}

/** HMAC-SHA256(key, msg) as lowercase hex (WebCrypto — available in the SW + tests). */
async function hmacSha256Hex(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time hex compare so a mac check can't be timing-probed. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Verify the /health identity challenge proves the server knows the connection token (#1):
 *   'ok'     — valid mac → this is the genuine desktop app; safe to send the token.
 *   'reject' — a nonce+mac was present but the mac is wrong → a rogue impersonating the app. Do NOT connect.
 *   'legacy' — no challenge in /health → an older app that predates this; caller keeps the old behaviour
 *              (backward-compatible) until the desktop always emits the challenge, then we can require it.
 */
export async function verifyHealthChallenge(token: string, health: BridgeHealth): Promise<'ok' | 'reject' | 'legacy'> {
  const nonce = typeof health.nonce === 'string' ? health.nonce : '';
  const mac = typeof health.mac === 'string' ? health.mac : '';
  if (!nonce || !mac) return 'legacy';
  const expected = await hmacSha256Hex(token, 'jh-health:' + nonce);
  return timingSafeEqualHex(mac.toLowerCase(), expected) ? 'ok' : 'reject';
}

/**
 * Call one RPC method against a known bridge port with the bearer token. Bounded by a
 * generous default timeout (AI methods like score/keywords are slow, so it's long — but
 * finite, so a crashed app surfaces an error instead of a forever-pending UI).
 */
export async function rpc<T = unknown>(
  port: number,
  token: string,
  method: string,
  params: unknown = {},
  opts: Opts = {},
): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
  // Validate the port before interpolating it into the URL — a poisoned stored value like
  // "1@evil.com" would otherwise parse as userinfo@host and send the Bearer token off-loopback
  // (finding #7). Restrict to a real port; the bridge only ever binds CANDIDATE_PORTS.
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid bridge port: ${String(port)}`);
  }
  let res: Response;
  try {
    res = await fetchWithTimeout(
      f,
      `http://127.0.0.1:${port}/rpc`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ method, params }),
      },
      opts.timeoutMs ?? 60000,
    );
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError')
      throw new Error(`RPC ${method} timed out — is the desktop app responding?`);
    throw e;
  }
  assertBodySize(res, MAX_RPC_BYTES);
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok) throw new Error(body?.error || `RPC ${method} failed (${res.status})`);
  return body.result as T;
}

/**
 * Discover the bridge and verify the token by fetching the profile. Throws a
 * user-facing message when the app isn't running or the token is wrong.
 */
export async function connect(token: string, opts: Opts = {}): Promise<BridgeConnection> {
  if (!token.trim())
    throw new Error('Paste the connection token from the JobHakken app (Settings → Browser extension).');
  const found = await discoverBridge(opts);
  if (!found) throw new Error('JobHakken desktop app not found. Open it and enable the browser extension in Settings.');
  // Prove the server on this port knows the token BEFORE we send it (else a rogue localhost server that
  // won name-only discovery would harvest the token + RPC content — #1).
  const verdict = await verifyHealthChallenge(token, found.health);
  if (verdict === 'reject') {
    throw new Error(
      'A local program is impersonating the JobHakken app — not connecting. Quit other JobHakken windows / restart the desktop app and try again.',
    );
  }
  // 'legacy' → an older desktop app that doesn't send the challenge yet; connect as before (backward
  // compatible). 'ok' → the server proved it holds the token, so it's genuine.
  let profile: BridgeProfile;
  try {
    profile = await rpc<BridgeProfile>(found.port, token, 'profile', {}, opts);
  } catch (e) {
    if (e instanceof Error && /unauthorized|401/i.test(e.message)) {
      throw new Error('That token was rejected. Copy the current token from the app’s Settings and try again.');
    }
    throw e;
  }
  return { port: found.port, token, profile };
}
