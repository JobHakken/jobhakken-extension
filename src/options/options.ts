import { deriveFullProfile, type EducationEntry, type ExperienceEntry, type FullProfile, type UserRule } from '@first2apply/autofill';

import { connect, rpc } from '../lib/bridgeClient.js';
import { clearConnection, loadConnection, saveConnection } from '../lib/connectionStore.js';
import { ADDITIONAL_FIELDS, PERSONAL_FIELDS, loadCaptureMode, loadFillSensitive, loadFullProfile, loadTestMode, saveCaptureMode, saveFillSensitive, saveFullProfile, saveTestMode } from '../lib/profileStore.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Working state (mutated by inputs; persisted on Save).
let fp: FullProfile = { profile: {}, experience: [], education: [], rules: [] };

// ── tabs ─────────────────────────────────────────────────────
$('tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
  if (!b) return;
  const key = b.dataset.t;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', (p as HTMLElement).dataset.p === key));
});

// ── personal / additional single fields ──────────────────────
function renderFields(containerId: string, defs: typeof PERSONAL_FIELDS) {
  const grid = $(containerId);
  grid.innerHTML = '';
  for (const d of defs) {
    const wrap = document.createElement('div');
    wrap.className = d.type === 'textarea' ? 'f full' : 'f';
    const label = document.createElement('label');
    label.innerHTML = d.sensitive ? `${d.label} <span class="lock">🔒</span>` : d.label;
    const input = d.type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
    input.value = (fp.profile[d.key] as string | undefined) ?? '';
    input.addEventListener('input', () => {
      const v = input.value.trim();
      if (v) fp.profile[d.key] = v;
      else delete fp.profile[d.key];
    });
    wrap.append(label, input);
    grid.appendChild(wrap);
  }
}

// ── education / experience arrays ─────────────────────────────
type EntryField<T> = { key: keyof T; label: string; type?: 'lines' };

function renderEntries<T extends Record<string, unknown>>(
  listId: string,
  items: T[],
  fields: EntryField<T>[],
) {
  const list = $(listId);
  list.innerHTML = '';
  items.forEach((item, idx) => {
    const box = document.createElement('div');
    box.className = 'entry';
    const rm = document.createElement('span');
    rm.className = 'rm';
    rm.textContent = '− Remove';
    rm.addEventListener('click', () => {
      items.splice(idx, 1);
      renderEntries(listId, items, fields);
    });
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const f of fields) {
      const wrap = document.createElement('div');
      wrap.className = f.type === 'lines' ? 'f full' : 'f';
      const label = document.createElement('label');
      label.textContent = f.label;
      if (f.type === 'lines') {
        // string[] <-> one bullet per line
        const ta = document.createElement('textarea');
        ta.placeholder = 'One bullet point per line';
        ta.value = ((item[f.key] as string[] | undefined) ?? []).join('\n');
        ta.addEventListener('input', () => {
          const lines = ta.value.split('\n').map((l) => l.trim()).filter(Boolean);
          (item[f.key] as unknown) = lines.length ? lines : undefined;
        });
        wrap.append(label, ta);
      } else {
        const input = document.createElement('input');
        input.value = (item[f.key] as string | undefined) ?? '';
        input.addEventListener('input', () => {
          (item[f.key] as unknown) = input.value.trim() || undefined;
        });
        wrap.append(label, input);
      }
      grid.appendChild(wrap);
    }
    box.append(rm, grid);
    list.appendChild(box);
  });
}

const EXP_FIELDS: EntryField<ExperienceEntry>[] = [
  { key: 'company', label: 'Company' },
  { key: 'position', label: 'Position' },
  { key: 'period', label: 'Period (e.g. Jun 2021 – Present)' },
  { key: 'highlights', label: 'Highlights / bullet points (one per line)', type: 'lines' },
];
const EDU_FIELDS: EntryField<EducationEntry>[] = [
  { key: 'school', label: 'School' },
  { key: 'degree', label: 'Degree' },
  { key: 'fieldOfStudy', label: 'Field of study' },
  { key: 'period', label: 'Period' },
];

function renderWork() {
  renderEntries('workList', (fp.experience ??= []), EXP_FIELDS);
}
function renderEdu() {
  renderEntries('eduList', (fp.education ??= []), EDU_FIELDS);
}

// ── custom rules ─────────────────────────────────────────────
function renderRules() {
  const list = $('ruleList');
  const rules = (fp.rules ??= []);
  list.innerHTML = '';
  rules.forEach((rule, idx) => {
    const row = document.createElement('div');
    row.className = 'rule';
    const cond = document.createElement('input');
    cond.placeholder = 'condition e.g. (notice period)';
    cond.value = rule.condition ?? '';
    cond.addEventListener('input', () => (rule.condition = cond.value));
    const val = document.createElement('input');
    val.placeholder = 'value to fill';
    val.value = rule.value ?? '';
    val.addEventListener('input', () => (rule.value = val.value));
    const rm = document.createElement('span');
    rm.className = 'rm';
    rm.textContent = '×';
    rm.addEventListener('click', () => {
      rules.splice(idx, 1);
      renderRules();
    });
    row.append(cond, val, rm);
    list.appendChild(row);
  });
}

// ── save ─────────────────────────────────────────────────────
function composeFullName() {
  const parts = [fp.profile.firstName, fp.profile.middleName, fp.profile.lastName].filter(Boolean);
  if (parts.length) fp.profile.fullName = parts.join(' ');
}
async function onSave() {
  composeFullName();
  await saveFullProfile(fp);
  $('profileStatus').innerHTML = '<span class="ok">✓ Profile saved</span>';
}

// ── desktop connection + import ──────────────────────────────
function renderConn(connected: boolean, name?: string, port?: number) {
  $('connStatus').innerHTML = connected
    ? `<span class="dot" style="background:#0f9d6b"></span><span class="ok">Connected</span> on 127.0.0.1:${port}${name ? ` · <b>${name}</b>` : ''}`
    : '';
  ($('disconnect') as HTMLButtonElement).hidden = !connected;
  ($('connect') as HTMLButtonElement).textContent = connected ? 'Reconnect' : 'Connect';
  ($('importBtn') as HTMLButtonElement).disabled = !connected;
  ($('importBtn') as HTMLButtonElement).title = connected ? 'Import your parsed résumé' : 'Connect the desktop app first (Desktop tab)';
}

async function onConnect() {
  const token = ($('token') as HTMLInputElement).value.trim();
  const btn = $('connect') as HTMLButtonElement;
  btn.disabled = true;
  $('connStatus').innerHTML = 'Connecting…';
  try {
    const conn = await connect(token);
    await saveConnection(conn);
    renderConn(true, conn.profile.basics?.name, conn.port);
  } catch (e) {
    $('connStatus').innerHTML = `<span class="err">${e instanceof Error ? e.message : 'Failed to connect'}</span>`;
    renderConn(false);
  } finally {
    btn.disabled = false;
  }
}

async function onDisconnect() {
  await clearConnection();
  ($('token') as HTMLInputElement).value = '';
  renderConn(false);
}

async function onImport() {
  const conn = await loadConnection();
  if (!conn) return;
  const btn = $('importBtn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    const full = await rpc<{
      basics?: Parameters<typeof deriveFullProfile>[0]['basics'];
      experience?: Parameters<typeof deriveFullProfile>[0]['experience'];
      education?: Parameters<typeof deriveFullProfile>[0]['education'];
    }>(conn.port, conn.token, 'profile', {});
    const imported = deriveFullProfile(full);
    // Merge: imported résumé data overrides fields, but keep the user's custom rules
    // and any manually-added additional fields not present in the résumé.
    fp = {
      profile: { ...fp.profile, ...imported.profile },
      experience: imported.experience?.length ? imported.experience : fp.experience,
      education: imported.education?.length ? imported.education : fp.education,
      rules: fp.rules,
    };
    renderAll();
    await saveFullProfile(fp);
    $('profileStatus').innerHTML = `<span class="ok">✓ Imported ${fp.experience?.length ?? 0} role(s), ${fp.education?.length ?? 0} school(s)</span>`;
  } catch (e) {
    $('profileStatus').innerHTML = `<span class="err">${e instanceof Error ? e.message : 'Import failed'}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import';
  }
}

function renderAll() {
  renderFields('personalGrid', PERSONAL_FIELDS);
  renderFields('additionalGrid', ADDITIONAL_FIELDS);
  renderWork();
  renderEdu();
  renderRules();
}

// ── init ─────────────────────────────────────────────────────
(async () => {
  fp = (await loadFullProfile()) ?? { profile: {}, experience: [], education: [], rules: [] };
  fp.experience ??= [];
  fp.education ??= [];
  fp.rules ??= [];
  renderAll();
  const sensitiveToggle = $('fillSensitive') as HTMLInputElement;
  sensitiveToggle.checked = await loadFillSensitive();
  sensitiveToggle.addEventListener('change', () => void saveFillSensitive(sensitiveToggle.checked));
  const testToggle = $('testMode') as HTMLInputElement;
  testToggle.checked = await loadTestMode();
  testToggle.addEventListener('change', () => {
    void saveTestMode(testToggle.checked);
    $('profileStatus').innerHTML = testToggle.checked
      ? '<span class="ok">🧪 Test mode on — autofilling anonymous dummy data</span>'
      : '';
  });
  const captureToggle = $('captureMode') as HTMLInputElement;
  captureToggle.checked = await loadCaptureMode();
  captureToggle.addEventListener('change', () => void saveCaptureMode(captureToggle.checked));
  const conn = await loadConnection();
  if (conn) {
    ($('token') as HTMLInputElement).value = conn.token;
    renderConn(true, conn.profile?.basics?.name, conn.port);
  }
})();

$('addWork').addEventListener('click', () => {
  (fp.experience ??= []).push({} as ExperienceEntry);
  renderWork();
});
$('addEdu').addEventListener('click', () => {
  (fp.education ??= []).push({} as EducationEntry);
  renderEdu();
});
$('addRule').addEventListener('click', () => {
  (fp.rules ??= []).push({ condition: '', value: '' } as UserRule);
  renderRules();
});
$('saveProfile').addEventListener('click', onSave);
$('connect').addEventListener('click', onConnect);
$('disconnect').addEventListener('click', onDisconnect);
$('importBtn').addEventListener('click', onImport);
