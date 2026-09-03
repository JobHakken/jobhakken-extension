/**
 * Talks to the JobHakken desktop app's loopback bridge (Phase 7.0). The bridge
 * binds one of a small candidate-port range on 127.0.0.1, so we discover it by
 * probing /health, then call the token-guarded /rpc surface.
 *
 * `fetchImpl` is injectable so the discovery/RPC logic is unit-testable.
 */
import { RESUME_SCHEMA_VERSION } from './vendor/resume/model.js';

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

// Mirrors the desktop app's `profile` RPC payload (source of truth:
// apps/desktopProbe/src/server/extensionBridge.ts). It sends the WHOLE structured profile —
// basics.{website,links} + experience[] + education[] — which `deriveFullProfile` maps into the autofill
// FullProfile. Declare it all so a refactor can't silently drop experience/education (the code fed it
// through a cast before, hiding the real shape). Fields are optional/defensive (older apps send less).
export type BridgeProfile = {
  hasResume: boolean;
  basics?: {
    name?: string;
    email?: string;
    phone?: string;
    location?: string;
    website?: string;
    links?: { text?: string; url?: string }[];
  };
  experience?: { company?: string; title?: string; period?: string }[];
  education?: { school?: string; degree?: string; field?: string; period?: string }[];
  resumeText?: string;
  /** ADR-0005 résumé payload version the app stamped (#283). Absent on older apps. */
  schemaVersion?: number;
};

export type BridgeConnection = { port: number; token: string; profile: BridgeProfile; schemaWarning?: string };

// The résumé-payload schema version this build understands (ADR-0005). Was a hardcoded literal with a
// TODO to import it once core published the constant; #482 vendors the résumé model for the native
// builder, which resolves that TODO as a side effect — this is now the SAME constant the builder writes.
export const SUPPORTED_RESUME_SCHEMA = RESUME_SCHEMA_VERSION;

/**
 * Validate a résumé payload version received over the bridge (ADR-0005). A NEWER app than this
 * extension understands may carry fields we'd mis-read, so we warn the user to update rather than
 * silently mis-fill. Older/equal/absent → no warning (we stay backward-compatible). Returns the
 * user-facing warning, or null when compatible.
 */
export function resumeSchemaWarning(version?: number): string | null {
  if (typeof version !== 'number' || version <= SUPPORTED_RESUME_SCHEMA) return null;
  return `Your JobHakken app uses a newer résumé format (v${version}) than this extension (v${SUPPORTED_RESUME_SCHEMA}). Update the extension for the most accurate autofill.`;
}

type Opts = { fetchImpl?: typeof fetch; ports?: number[]; timeoutMs?: number };

// /health is unauthenticated (probe-friendly). It advertises `capabilities.handshake` — the app
// supports the #283 challenge-response — and `resumeSchemaVersion` (the ADR-0005 payload version).
// When handshake is advertised we PROVE the server holds the shared token via /handshake BEFORE
// sending it, so a rogue localhost server that merely echoes name:'jobhakken' can't harvest the token
// or any RPC content (#1). Name-only is never trusted with the token.
export type BridgeHealth = {
  name?: string;
  capabilities?: { handshake?: boolean };
  resumeSchemaVersion?: number;
};

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

/** HMAC-SHA256(key, msg) as base64 — matches the desktop app's `computeHandshakeMac` (#283). WebCrypto
 *  + btoa are both available in the MV3 service worker and in jest. */
async function hmacSha256Base64(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  let bin = '';
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Constant-time string compare so a mac check can't be timing-probed. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** A fresh random nonce for a handshake (hex — comfortably within the app's 8..4096 length bound). */
function makeNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Prove the server on `port` holds the shared connection token WITHOUT revealing our copy (#1 / #283).
 * We POST a fresh, client-generated nonce to /handshake; the genuine app answers
 * `mac = base64(HMAC-SHA256(token, nonce))`. A rogue localhost server that won name-only discovery but
 * doesn't know the token can't forge this, so we refuse it before ever sending the token to /rpc.
 * The token itself never goes on the wire here — only the nonce out and the mac back. Returns true iff
 * the mac verifies (a fresh nonce each call means a captured mac can't be replayed).
 */
export async function performHandshake(token: string, port: number, opts: Opts = {}): Promise<boolean> {
  const f = opts.fetchImpl ?? fetch;
  const nonce = makeNonce();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      f,
      `http://127.0.0.1:${port}/handshake`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce }) },
      opts.timeoutMs ?? 1500,
    );
  } catch {
    return false; // /handshake unreachable → proof failed
  }
  if (!res.ok) return false;
  assertBodySize(res, MAX_HEALTH_BYTES);
  const body = (await res.json().catch(() => ({}))) as { mac?: unknown };
  const mac = typeof body.mac === 'string' ? body.mac : '';
  if (!mac) return false;
  return timingSafeEqual(mac, await hmacSha256Base64(token, nonce));
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
  // When the app advertises the handshake capability, PROVE it holds the token BEFORE we send it — a
  // rogue localhost server that won name-only discovery can't forge the mac, so we refuse it and never
  // leak the token or RPC content (#1 / #283). An older app that doesn't advertise it predates the
  // handshake; connect as before (backward-compatible during rollout — the app ships this first).
  if (found.health.capabilities?.handshake) {
    const proven = await performHandshake(token, found.port, opts);
    if (!proven) {
      throw new Error(
        'A local program is impersonating the JobHakken app — not connecting. Quit other JobHakken windows / restart the desktop app and try again.',
      );
    }
  }
  let profile: BridgeProfile;
  try {
    profile = await rpc<BridgeProfile>(found.port, token, 'profile', {}, opts);
  } catch (e) {
    if (e instanceof Error && /unauthorized|401/i.test(e.message)) {
      throw new Error('That token was rejected. Copy the current token from the app’s Settings and try again.');
    }
    throw e;
  }
  // ADR-0005: validate the résumé payload version — warn (don't block) if the app is newer than us.
  return { port: found.port, token, profile, schemaWarning: resumeSchemaWarning(profile.schemaVersion) ?? undefined };
}
