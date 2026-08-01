/**
 * Optional host permissions for bring-your-own-key AI providers. We ship these as OPTIONAL (not in
 * `host_permissions`) so a DEFAULT install requests **no third-party AI host at all** — the extension
 * only ever talks to your local desktop app and jobhakken.com out of the box. Only when you bring your
 * own LLM key do we request the ONE provider you chose, at runtime, from a user gesture (the Save
 * button). This keeps the permission surface minimal (the whole point vs. all-sites autofill
 * extensions) and means adding providers later never triggers an on-update re-prompt.
 *
 * Local endpoints (127.0.0.1 / localhost) need no grant — they're already in `host_permissions` for the
 * desktop bridge. Managed AI runs through jobhakken.com, also already permitted. So this module is only
 * about BYOK direct calls to hosted providers.
 */

/** The hosted OpenAI-compatible providers we can request. Mirrors `optional_host_permissions` in the
 *  manifest — a request for a host NOT in this list is rejected by Chrome, so keep the two in sync. */
export const AI_PROVIDER_ORIGINS = [
  'https://openrouter.ai/*',
  'https://api.openai.com/*',
  'https://api.groq.com/*',
  'https://api.together.xyz/*',
  'https://api.mistral.ai/*',
  'https://api.deepseek.com/*',
  'https://api.perplexity.ai/*',
  'https://generativelanguage.googleapis.com/*',
  'https://api.anthropic.com/*',
  'https://api.fireworks.ai/*',
  'https://api.x.ai/*',
] as const;

const KNOWN_HOSTS = new Set(AI_PROVIDER_ORIGINS.map((o) => new URL(o.replace(/\*$/, '')).hostname));

/** True for a loopback endpoint that's already permitted (no grant needed). */
export function isLocalHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname.endsWith('.localhost');
}

function tryUrl(base: string): URL | null {
  try {
    return new URL(base);
  } catch {
    return null;
  }
}

/** The `https://host/*` match pattern for a base URL, or null if it isn't an http(s) URL. */
export function originPattern(base: string): string | null {
  const u = tryUrl(base);
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return null;
  return `${u.protocol}//${u.hostname}/*`;
}

/** True when the base URL's host is one we're allowed to request (in the optional list). */
export function isKnownProvider(base: string): boolean {
  const u = tryUrl(base);
  return !!u && KNOWN_HOSTS.has(u.hostname);
}

export type PermOutcome = 'granted' | 'denied' | 'unsupported' | 'local';

/**
 * Ensure we hold the host permission for a BYOK base URL. MUST be called from a user gesture (the Save
 * button) for `request()` to prompt. `'local'` = loopback (no grant needed), `'granted'`/`'denied'` =
 * the prompt result, `'unsupported'` = a host not in our optional list (can't be requested).
 */
export async function ensureAiHostPermission(base: string): Promise<PermOutcome> {
  const u = tryUrl(base);
  if (!u) return 'unsupported';
  if (isLocalHost(u.hostname)) return 'local';
  const pattern = originPattern(base);
  if (!pattern || !isKnownProvider(base)) return 'unsupported';
  if (await chrome.permissions.contains({ origins: [pattern] })) return 'granted';
  const ok = await chrome.permissions.request({ origins: [pattern] });
  return ok ? 'granted' : 'denied';
}

/** Non-interactive pre-flight (SW / options load): do we already hold permission for this base URL?
 *  Local endpoints return true (already permitted). A non-URL / unknown host returns false. */
export async function hasAiHostPermission(base: string): Promise<boolean> {
  const u = tryUrl(base);
  if (!u) return false;
  if (isLocalHost(u.hostname)) return true;
  const pattern = originPattern(base);
  if (!pattern) return false;
  return chrome.permissions.contains({ origins: [pattern] });
}
