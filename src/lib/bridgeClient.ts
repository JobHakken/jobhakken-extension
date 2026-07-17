/**
 * Talks to the Jobhakken desktop app's loopback bridge (Phase 7.0). The bridge
 * binds one of a small candidate-port range on 127.0.0.1, so we discover it by
 * probing /health, then call the token-guarded /rpc surface.
 *
 * `fetchImpl` is injectable so the discovery/RPC logic is unit-testable.
 */

// Must match the candidate list the desktop bridge binds (extensionBridge.ts).
export const CANDIDATE_PORTS = [41573, 41574, 41575, 41576, 41577];

export type BridgeProfile = {
  hasResume: boolean;
  basics?: { name?: string; email?: string; phone?: string; location?: string };
  resumeText?: string;
};

export type BridgeConnection = { port: number; token: string; profile: BridgeProfile };

type Opts = { fetchImpl?: typeof fetch; ports?: number[]; timeoutMs?: number };

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

/** Find the desktop bridge by probing /health across the candidate ports. */
export async function discoverBridge(opts: Opts = {}): Promise<{ port: number } | null> {
  const f = opts.fetchImpl ?? fetch;
  for (const port of opts.ports ?? CANDIDATE_PORTS) {
    try {
      const res = await fetchWithTimeout(f, `http://127.0.0.1:${port}/health`, {}, opts.timeoutMs ?? 1500);
      if (!res.ok) continue;
      const body = (await res.json()) as { name?: string };
      if (body?.name === 'jobhakken') return { port };
    } catch {
      /* nothing listening (or timed out) — try the next port */
    }
  }
  return null;
}

/**
 * Call one RPC method against a known bridge port with the bearer token. Bounded by a
 * generous default timeout (AI methods like score/keywords are slow, so it's long — but
 * finite, so a crashed app surfaces an error instead of a forever-pending UI).
 */
export async function rpc<T = unknown>(port: number, token: string, method: string, params: unknown = {}, opts: Opts = {}): Promise<T> {
  const f = opts.fetchImpl ?? fetch;
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
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`RPC ${method} timed out — is the desktop app responding?`);
    throw e;
  }
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok) throw new Error(body?.error || `RPC ${method} failed (${res.status})`);
  return body.result as T;
}

/**
 * Discover the bridge and verify the token by fetching the profile. Throws a
 * user-facing message when the app isn't running or the token is wrong.
 */
export async function connect(token: string, opts: Opts = {}): Promise<BridgeConnection> {
  if (!token.trim()) throw new Error('Paste the connection token from the Jobhakken app (Settings → Browser extension).');
  const found = await discoverBridge(opts);
  if (!found) throw new Error('Jobhakken desktop app not found. Open it and enable the browser extension in Settings.');
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
