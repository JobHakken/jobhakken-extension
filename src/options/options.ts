import { connect } from '../lib/bridgeClient.js';
import { clearConnection, loadConnection, saveConnection } from '../lib/connectionStore.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const tokenInput = $<HTMLInputElement>('token');
const connectBtn = $<HTMLButtonElement>('connect');
const disconnectBtn = $<HTMLButtonElement>('disconnect');
const statusEl = $<HTMLDivElement>('status');

function showStatus(html: string) {
  statusEl.hidden = false;
  statusEl.innerHTML = html;
}

function renderConnected(name: string | undefined, port: number) {
  showStatus(
    `<span class="dot ok" style="background:#0f9d6b"></span><span class="ok">Connected</span> to First2Apply on 127.0.0.1:${port}` +
      (name ? ` · signed in as <b>${name}</b>` : ' · no résumé saved yet'),
  );
  disconnectBtn.hidden = false;
  connectBtn.textContent = 'Reconnect';
}

function renderDisconnected() {
  disconnectBtn.hidden = true;
  connectBtn.textContent = 'Connect';
}

async function doConnect() {
  const token = tokenInput.value.trim();
  connectBtn.disabled = true;
  showStatus('<span class="dot" style="background:#9aa1ac"></span>Connecting…');
  try {
    const conn = await connect(token);
    await saveConnection(conn);
    renderConnected(conn.profile.basics?.name, conn.port);
  } catch (e) {
    showStatus(`<span class="dot err" style="background:#dc2626"></span><span class="err">${e instanceof Error ? e.message : 'Failed to connect'}</span>`);
    renderDisconnected();
  } finally {
    connectBtn.disabled = false;
  }
}

async function doDisconnect() {
  await clearConnection();
  tokenInput.value = '';
  statusEl.hidden = true;
  renderDisconnected();
}

// Restore any saved connection on open.
(async () => {
  const saved = await loadConnection();
  if (saved) {
    tokenInput.value = saved.token;
    renderConnected(saved.profile?.basics?.name, saved.port);
  }
})();

connectBtn.addEventListener('click', doConnect);
disconnectBtn.addEventListener('click', doDisconnect);
