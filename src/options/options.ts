import { deriveProfile, type Profile } from '@first2apply/autofill';

import { connect } from '../lib/bridgeClient.js';
import { clearConnection, loadConnection, saveConnection } from '../lib/connectionStore.js';
import { PROFILE_FIELDS, loadProfile, saveProfile } from '../lib/profileStore.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ── profile editor (standalone) ──────────────────────────────
const inputs = new Map<keyof Profile, HTMLInputElement>();

function buildProfileForm(profile: Profile | null) {
  const form = $('profileForm');
  form.innerHTML = '';
  for (const field of PROFILE_FIELDS) {
    const wrap = document.createElement('div');
    wrap.className = 'f';
    const label = document.createElement('label');
    label.textContent = field.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = field.placeholder ?? '';
    input.value = (profile?.[field.key] as string | undefined) ?? '';
    wrap.append(label, input);
    form.appendChild(wrap);
    inputs.set(field.key, input);
  }
}

async function onSaveProfile() {
  const get = (k: keyof Profile) => inputs.get(k)?.value.trim() ?? '';
  // deriveProfile splits the full name into first/last so those fields fill too.
  const profile = deriveProfile({
    name: get('fullName'),
    email: get('email'),
    phone: get('phone'),
    location: get('location'),
    linkedin: get('linkedin'),
    github: get('github'),
    website: get('website'),
    currentCompany: get('currentCompany'),
    currentTitle: get('currentTitle'),
    school: get('school'),
    degree: get('degree'),
    fieldOfStudy: get('fieldOfStudy'),
  });
  await saveProfile(profile);
  $('profileStatus').innerHTML = '<span class="ok">✓ Profile saved</span>';
}

// ── desktop connection (optional) ────────────────────────────
function renderConn(connected: boolean, name?: string, port?: number) {
  const s = $('connStatus');
  s.hidden = false;
  s.innerHTML = connected
    ? `<span class="dot" style="background:#0f9d6b"></span><span class="ok">Connected</span> on 127.0.0.1:${port}${name ? ` · <b>${name}</b>` : ''}`
    : '';
  ($('disconnect') as HTMLButtonElement).hidden = !connected;
  ($('connect') as HTMLButtonElement).textContent = connected ? 'Reconnect' : 'Connect';
}

async function onConnect() {
  const token = ($('token') as HTMLInputElement).value.trim();
  const btn = $('connect') as HTMLButtonElement;
  btn.disabled = true;
  $('connStatus').hidden = false;
  $('connStatus').innerHTML = '<span class="dot" style="background:#9aa1ac"></span>Connecting…';
  try {
    const conn = await connect(token);
    await saveConnection(conn);
    renderConn(true, conn.profile.basics?.name, conn.port);
  } catch (e) {
    $('connStatus').innerHTML = `<span class="dot" style="background:#dc2626"></span><span class="err">${e instanceof Error ? e.message : 'Failed to connect'}</span>`;
    ($('disconnect') as HTMLButtonElement).hidden = true;
  } finally {
    btn.disabled = false;
  }
}

async function onDisconnect() {
  await clearConnection();
  ($('token') as HTMLInputElement).value = '';
  $('connStatus').hidden = true;
  renderConn(false);
}

(async () => {
  buildProfileForm(await loadProfile());
  const conn = await loadConnection();
  if (conn) {
    ($('token') as HTMLInputElement).value = conn.token;
    renderConn(true, conn.profile?.basics?.name, conn.port);
  }
})();

$('saveProfile').addEventListener('click', onSaveProfile);
$('connect').addEventListener('click', onConnect);
$('disconnect').addEventListener('click', onDisconnect);
