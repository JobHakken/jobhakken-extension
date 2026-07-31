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
export const LOGIN_URL = `${WEB_APP_ORIGIN}/login`;
export const ACCOUNT_URL = `${WEB_APP_ORIGIN}/account`;

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
