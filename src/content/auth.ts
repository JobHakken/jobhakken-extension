/**
 * Auth bridge — runs ONLY on app.jobhakken.com. The user signs in on the website (its existing
 * Supabase flow); this reads the resulting session from the page's localStorage and forwards the
 * identity to the service worker, so the extension knows who's signed in without reimplementing auth.
 *
 * Content scripts share the host page's same-origin localStorage, so `sb-<ref>-auth-token` is readable
 * here. We never touch the page's DOM or send anything off-device — just a runtime message to our SW.
 */
import { parseSupabaseSession, type Identity } from '../lib/authStore.js';

function readSession(): Identity | null {
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
