import { autofillForm, deriveProfile, detectFields, type Profile } from '@first2apply/autofill';

import { loadConnection } from '../lib/connectionStore.js';

/**
 * Content script (Phase 7.2). On every page it detects fillable fields and reports
 * the count so the toolbar badge shows the extension is ON; on command (toolbar
 * click / keyboard shortcut) it autofills from the cached profile. Works offline —
 * detection + seed/heuristic fill need no desktop app.
 */

async function getProfile(): Promise<Profile | null> {
  const conn = await loadConnection();
  const basics = conn?.profile?.basics as
    | { name?: string; email?: string; phone?: string; location?: string; customFields?: Array<{ name?: string; value?: string }> }
    | undefined;
  if (!basics) return null;
  const findLink = (kw: string) =>
    basics.customFields?.find((f) => `${f.name ?? ''} ${f.value ?? ''}`.toLowerCase().includes(kw))?.value;
  return deriveProfile({
    name: basics.name,
    email: basics.email,
    phone: basics.phone,
    location: basics.location,
    linkedin: findLink('linkedin'),
    github: findLink('github'),
  });
}

function updateBadge(): void {
  const count = detectFields(document).length;
  void chrome.runtime.sendMessage({ type: 'f2a-detected', count }).catch(() => {});
}

async function runAutofill(): Promise<void> {
  const profile = await getProfile();
  if (!profile) {
    void chrome.runtime.sendMessage({ type: 'f2a-notify', text: 'Connect First2Apply in the extension options first.' }).catch(() => {});
    return;
  }
  const report = autofillForm({ root: document, profile });
  void chrome.runtime
    .sendMessage({ type: 'f2a-filled', filled: report.filled, review: report.review, unmapped: report.unmapped, total: report.total })
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'f2a-run-autofill') void runAutofill();
});

// Initial detect + re-detect on SPA/DOM changes (debounced) so the badge tracks the page.
let timer: ReturnType<typeof setTimeout> | undefined;
const schedule = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(updateBadge, 500);
};
updateBadge();
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
