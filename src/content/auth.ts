/**
 * Auth bridge — runs ONLY on app.jobhakken.com. The user signs in on the website (its existing
 * Supabase flow); this reads the resulting session and forwards the identity to the service worker,
 * so the extension knows who's signed in without reimplementing auth.
 *
 * The webapp uses `@supabase/ssr`, which keeps the session in COOKIES (not localStorage) and chunks
 * large sessions across `sb-<ref>-auth-token.0/.1/…`. Those cookies are not httpOnly, so this
 * same-origin content script can read them via `document.cookie` (see parseSupabaseCookies). We keep a
 * localStorage fallback for older/local-dev flows. We never touch the page's DOM or send anything
 * off-device — just a runtime message to our SW.
 */
import { parseSupabaseCookies, parseSupabaseSession, type Identity } from '../lib/authStore.js';

function readSession(): Identity | null {
  // Primary: @supabase/ssr session cookies.
  try {
    const fromCookie = parseSupabaseCookies(document.cookie);
    if (fromCookie) return fromCookie;
  } catch {
    /* cookie access blocked — fall through to localStorage */
  }
  // Fallback: older/local-dev flows that keep the session in localStorage.
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.*-auth-token$/.test(k)) {
        const raw = localStorage.getItem(k);
        if (raw) {
          const id = parseSupabaseSession(raw);
          if (id) return id;
        }
      }
    }
  } catch {
    /* storage access blocked — treat as signed out */
  }
  return null;
}

let last: string | null = null; // sentinel: the FIRST sync always reports (even signed-out), so the
// extension's identity stays in step with the site on every page load — including a signed-out load
// that must clear a stale identity.
function sync(): void {
  const id = readSession();
  const sig = id ? `${id.email}:${id.expiresAt ?? ''}` : ''; // '' = signed out
  if (sig === last) return; // only message the SW on a real change
  last = sig;
  void chrome.runtime.sendMessage({ type: 'f2a-auth', identity: id }).catch(() => {});
}

sync();
// Login/logout can happen after load and in the same tab (no `storage` event) → poll + react to focus.
window.addEventListener('focus', sync);
window.addEventListener('storage', sync);
setInterval(sync, 4000);
