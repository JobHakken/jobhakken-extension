/**
 * Sign-in identity for the extension. We do NOT reimplement auth — the user signs in on the website
 * (app.jobhakken.com), which already has the full Supabase flow (password / OTP / Google). A tiny
 * content script on that origin reads the resulting session and hands us the identity, which we keep
 * here for the identity/entitlement gate (managed AI tier, snapshot sync).
 *
 * SECURITY: identity is on-device only. We store email/userId/tier + the short-lived access token
 * (for future entitlement calls) but NOT the refresh token (the most sensitive part stays with the
 * website's own session). Nothing here is content; consistent with ADR-0003/0009.
 */

export const WEB_APP_ORIGIN = 'https://app.jobhakken.com';
export const LOGIN_URL = `${WEB_APP_ORIGIN}/`; // the app root hosts sign-in
export const ACCOUNT_URL = `${WEB_APP_ORIGIN}/account`;
export const ENTITLEMENT_URL = `${WEB_APP_ORIGIN}/api/entitlement`;

/**
 * Fetch the authoritative managed-AI tier from the webapp. The real tier lives in
 * `profiles.subscription_tier` (written by the Stripe webhook), NOT in the session-token metadata, so
 * we call the Bearer-authed endpoint with the stored access token (no cookies). Expired subscriptions
 * return `free`. Returns undefined on any failure — the caller then keeps whatever tier it already had.
 */
export async function fetchEntitlement(accessToken: string): Promise<string | undefined> {
  if (!accessToken) return undefined;
  try {
    const res = await fetch(ENTITLEMENT_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { tier?: unknown };
    return typeof data.tier === 'string' ? data.tier : undefined;
  } catch {
    return undefined; // offline / CORS / malformed — fail soft (treated as no managed entitlement)
  }
}

export type Identity = {
  email: string;
  userId: string;
  tier?: string;
  accessToken?: string;
  expiresAt?: number; // unix seconds
};

const KEY = 'f2a_identity';

export async function saveIdentity(id: Identity): Promise<void> {
  await chrome.storage.local.set({ [KEY]: id });
}

export async function loadIdentity(): Promise<Identity | null> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as Identity | undefined) ?? null;
}

export async function clearIdentity(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

/**
 * Parse a Supabase auth-token localStorage value into our Identity. Handles both the supabase-js v2
 * shape (session fields at the top level) and the v1 `{ currentSession }` wrapper. The refresh token
 * is deliberately dropped. Returns null when there's no usable session (signed out / malformed).
 */
export function parseSupabaseSession(raw: string): Identity | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null; // JSON.parse('null') / '"x"' / '5' etc.
  const root = obj as Record<string, unknown>;
  const s = ((root.currentSession as Record<string, unknown>) ?? root) as Record<string, unknown>;
  const user = s.user as
    | { id?: string; email?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }
    | undefined;
  if (!user?.email) return null;
  const tier = (user.app_metadata?.tier ?? user.user_metadata?.tier) as string | undefined;
  return {
    email: String(user.email),
    userId: String(user.id ?? ''),
    tier: tier ? String(tier) : undefined,
    accessToken: typeof s.access_token === 'string' ? s.access_token : undefined,
    expiresAt: typeof s.expires_at === 'number' ? (s.expires_at as number) : undefined,
  };
}

/** Decode a base64url (or standard base64) payload to a UTF-8 string. */
function base64ToString(b64: string): string {
  const std = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Parse the Supabase session out of a `document.cookie` string. The webapp uses `@supabase/ssr`, which
 * keeps the session in cookies (NOT localStorage) and, for large sessions, CHUNKS the value across
 * `sb-<ref>-auth-token.0`, `.1`, … with a `base64-` prefix. We reassemble the chunks in order and
 * base64-decode before parsing — a single-cookie read silently fails for real (chunked) sessions.
 * Cookies are not httpOnly (the webapp never sets it), so a same-origin content script can read them.
 * Returns the identity, or null when signed out / unparseable.
 */
export function parseSupabaseCookies(cookieHeader: string): Identity | null {
  if (!cookieHeader) return null;
  const jar = new Map<string, string>();
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep raw if not percent-encoded */
    }
    if (name) jar.set(name, value);
  }
  // Group `sb-<ref>-auth-token[.<n>]` cookies by base name.
  const bases = new Map<string, { whole?: string; chunks: Map<number, string> }>();
  for (const [name, value] of jar) {
    const m = /^(sb-.+-auth-token)(?:\.(\d+))?$/.exec(name);
    if (!m) continue;
    const entry = bases.get(m[1]) ?? { chunks: new Map<number, string>() };
    if (m[2] === undefined) entry.whole = value;
    else entry.chunks.set(Number(m[2]), value);
    bases.set(m[1], entry);
  }
  for (const { whole, chunks } of bases.values()) {
    let raw = whole;
    if (raw === undefined && chunks.size) {
      raw = [...chunks.keys()]
        .sort((a, b) => a - b)
        .map((i) => chunks.get(i) ?? '')
        .join('');
    }
    if (!raw) continue;
    let json = raw;
    if (raw.startsWith('base64-')) {
      try {
        json = base64ToString(raw.slice('base64-'.length));
      } catch {
        continue;
      }
    }
    const id = parseSupabaseSession(json);
    if (id) return id;
  }
  return null;
}
