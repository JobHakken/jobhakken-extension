import { loadConnection } from '../lib/connectionStore.js';
import { loadProfile } from '../lib/profileStore.js';

/** Compact toolbar popup: status + one-click autofill + link to options. */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

(async () => {
  const [conn, profile] = await Promise.all([loadConnection(), loadProfile()]);
  const mode = conn ? 'connected' : profile ? 'standalone' : 'none';
  $('dot').className = `dot ${mode}`;
  $<HTMLElement>('statusText').textContent =
    mode === 'connected'
      ? `Connected · ${conn?.profile?.basics?.name ?? 'desktop app'}`
      : mode === 'standalone'
        ? 'Standalone · using your saved profile'
        : 'No profile yet — add one in settings';
})();

$('autofill').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) void chrome.tabs.sendMessage(tab.id, { type: 'f2a-run-autofill' }).catch(() => {});
  $<HTMLElement>('msg').textContent = 'Autofilling the active tab…';
});

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
