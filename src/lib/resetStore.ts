/**
 * Full factory reset of the extension's local data (Options → "Reset extension").
 *
 * Wipes EVERYTHING in chrome.storage.local + .session — autofill profile, uploaded résumé, learned
 * answers, captured forms, BYOK AI key/config/usage, "run on this site" opt-ins, sponsorship flags,
 * every settings toggle, onboarding-dismissal state, and the web account sign-in — EXCEPT the
 * desktop-app connection (`f2a_connection`), which is a device pairing, not user data, and is kept so a
 * reset doesn't unpair the app. Cleared settings fall back to their defaults on next read.
 *
 * The one preserved key is intentionally the ONLY exception (allow-list, not a block-list) so any key a
 * future feature adds is wiped by default — a reset can never silently leave stale personal data behind.
 */
const PRESERVE = 'f2a_connection';

export async function resetAllData(): Promise<void> {
  const kept = await chrome.storage.local.get(PRESERVE);
  await Promise.all([chrome.storage.local.clear(), chrome.storage.session.clear()]);
  if (kept[PRESERVE] !== undefined) await chrome.storage.local.set({ [PRESERVE]: kept[PRESERVE] });
}
