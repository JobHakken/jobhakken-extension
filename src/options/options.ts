import {
  deriveFullProfile,
  type EducationEntry,
  type ExperienceEntry,
  type FullProfile,
  type UserRule,
} from '@jobhakken/autofill';

import { connect, rpc } from '../lib/bridgeClient.js';
import { clearConnection, loadConnection, saveConnection } from '../lib/connectionStore.js';
import { clearCaptures, getCaptures, getOptInSites, setSiteOptIn } from '../lib/captureStore.js';
import { escapeHtml } from '../lib/html.js';
import { report } from '../lib/telemetryClient.js';
import { TEST_PROFILE } from '../lib/testProfile.js';
import { getTelemetryEnabled, setTelemetryEnabled } from '../lib/telemetry.js';
import { initThemeToggle } from '../lib/theme.js';
import {
  ADDITIONAL_FIELDS,
  PERSONAL_FIELDS,
  loadAutoCapture,
  loadCaptureMode,
  loadFillSensitive,
  loadFullProfile,
  loadHideUnsponsored,
  loadNeedsSponsorship,
  loadTestMode,
  saveAutoCapture,
  saveCaptureMode,
  saveFillSensitive,
  saveFullProfile,
  saveHideUnsponsored,
  saveNeedsSponsorship,
  saveTestMode,
} from '../lib/profileStore.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Working state (mutated by inputs; persisted on Save).
let fp: FullProfile = { profile: {}, experience: [], education: [], rules: [] };
let testModeOn = false; // extension test toggle (import brings dummy data when on)

void initThemeToggle($('theme')); // manual light/dark toggle (default: follow system)

// ── tabs ─────────────────────────────────────────────────────
$('tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
  if (!b) return;
  const key = b.dataset.t;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
  document
    .querySelectorAll('.panel')
    .forEach((p) => p.classList.toggle('active', (p as HTMLElement).dataset.p === key));
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

function renderEntries<T extends Record<string, unknown>>(listId: string, items: T[], fields: EntryField<T>[]) {
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
          const lines = ta.value
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
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
function renderConn(connected: boolean, name?: string) {
  // In test mode, never surface the real cached identity — show a neutral test label.
  const shownName = testModeOn ? '🧪 Demo mode' : name;
  // shownName is résumé-derived (untrusted) → escape before inserting into HTML.
  $('connStatus').innerHTML = connected
    ? `<span class="dot" style="background:#0f9d6b"></span><span class="ok">Connected</span> to the JobHakken app${shownName ? ` · <b>${escapeHtml(shownName)}</b>` : ''}`
    : '';
  ($('disconnect') as HTMLButtonElement).hidden = !connected;
  ($('connect') as HTMLButtonElement).textContent = connected ? 'Reconnect' : 'Connect';
  // in test mode, Import brings the dummy profile — usable even without a connection
  const importBtn = $('importBtn') as HTMLButtonElement;
  importBtn.dataset.connected = connected ? '1' : '0';
  importBtn.disabled = !connected && !testModeOn;
  importBtn.title = testModeOn
    ? 'Import anonymous sample data'
    : connected
      ? 'Import your parsed résumé'
      : 'Connect the desktop app first (Desktop tab)';
}

async function onConnect() {
  const token = ($('token') as HTMLInputElement).value.trim();
  const btn = $('connect') as HTMLButtonElement;
  btn.disabled = true;
  $('connStatus').innerHTML = 'Connecting…';
  try {
    const conn = await connect(token);
    await saveConnection(conn);
    renderConn(true, conn.profile.basics?.name);
    report('bridge_connected', { ok: true });
  } catch (e) {
    report('bridge_failed', { ok: false });
    $('connStatus').innerHTML =
      `<span class="err">${escapeHtml(e instanceof Error ? e.message : 'Failed to connect')}</span>`;
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

/** App test mode via the bridge (options page can call it directly — it's an extension page). */
async function appInTestMode(conn: { port: number; token: string }): Promise<boolean> {
  try {
    const s = await rpc<{ testMode?: boolean }>(conn.port, conn.token, 'status', {});
    return !!s?.testMode;
  } catch {
    return false;
  }
}

async function onImport() {
  const conn = await loadConnection();
  const btn = $('importBtn') as HTMLButtonElement;
  // TEST MODE (extension toggle, or the connected app's sandbox) → import the anonymous
  // dummy profile, never the real résumé.
  if (testModeOn || (conn && (await appInTestMode(conn)))) {
    fp = JSON.parse(JSON.stringify(TEST_PROFILE)) as FullProfile;
    renderAll();
    await saveFullProfile(fp);
    $('profileStatus').innerHTML =
      `<span class="ok">🧪 Imported sample data (${fp.experience?.length ?? 0} role(s), ${fp.education?.length ?? 0} school(s))</span>`;
    return;
  }
  if (!conn) return;
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
    $('profileStatus').innerHTML =
      `<span class="ok">✓ Imported ${fp.experience?.length ?? 0} role(s), ${fp.education?.length ?? 0} school(s)</span>`;
  } catch (e) {
    $('profileStatus').innerHTML =
      `<span class="err">${escapeHtml(e instanceof Error ? e.message : 'Import failed')}</span>`;
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
  testModeOn = testToggle.checked;
  testToggle.addEventListener('change', () => {
    testModeOn = testToggle.checked;
    void saveTestMode(testToggle.checked);
    // reflect on the Import button (usable in test mode → imports dummy data)
    const ib = $('importBtn') as HTMLButtonElement;
    ib.disabled = !testModeOn && ib.dataset.connected !== '1';
    ib.title = testModeOn
      ? 'Import anonymous sample data'
      : ib.dataset.connected === '1'
        ? 'Import your parsed résumé'
        : 'Connect the desktop app first (Desktop tab)';
    $('profileStatus').innerHTML = testToggle.checked
      ? '<span class="ok">🧪 Demo mode on — autofilling anonymous sample data</span>'
      : '';
    // re-render the connection line so the identity masks/unmasks immediately
    void loadConnection().then((c) => (c ? renderConn(true, c.profile?.basics?.name) : renderConn(false)));
  });
  const sponsorToggle = $('needsSponsorship') as HTMLInputElement;
  const hideToggle = $('hideUnsponsored') as HTMLInputElement;
  sponsorToggle.checked = await loadNeedsSponsorship();
  hideToggle.checked = await loadHideUnsponsored();
  hideToggle.disabled = !sponsorToggle.checked; // only meaningful when the filter is on
  sponsorToggle.addEventListener('change', () => {
    void saveNeedsSponsorship(sponsorToggle.checked);
    hideToggle.disabled = !sponsorToggle.checked;
  });
  hideToggle.addEventListener('change', () => void saveHideUnsponsored(hideToggle.checked));

  const captureToggle = $('captureMode') as HTMLInputElement;
  captureToggle.checked = await loadCaptureMode();
  captureToggle.addEventListener('change', () => void saveCaptureMode(captureToggle.checked));
  // anonymous usage analytics (opt-out)
  const telemetryToggle = $('telemetryToggle') as HTMLInputElement;
  telemetryToggle.checked = await getTelemetryEnabled();
  telemetryToggle.addEventListener('change', () => void setTelemetryEnabled(telemetryToggle.checked));
  // auto-capture corpus
  const autoToggle = $('autoCapture') as HTMLInputElement;
  autoToggle.checked = await loadAutoCapture();
  autoToggle.addEventListener('change', () => void saveAutoCapture(autoToggle.checked));
  const refreshCount = async () => {
    const n = (await getCaptures()).length;
    $('capCount').textContent = n ? ` — ${n} captured` : ' — none yet';
  };
  void refreshCount();
  $('exportCorpus').addEventListener('click', async () => {
    const all = await getCaptures();
    if (!all.length) return void ($('profileStatus').innerHTML = '<span class="err">No captures yet</span>');
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jobhakken-corpus-${all.length}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  $('clearCorpus').addEventListener('click', async () => {
    if (!confirm('Clear all captured applications?')) return;
    await clearCaptures();
    await refreshCount();
  });
  // My sites — user-managed hosts where the extension is always active
  const normHost = (v: string): string => {
    const s = v.trim();
    try {
      return new URL(s.includes('://') ? s : `https://${s}`).hostname.replace(/^www\./, '');
    } catch {
      return s
        .toLowerCase()
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
    }
  };
  const renderSites = async () => {
    const list = $('siteList');
    const sites = await getOptInSites();
    list.innerHTML = sites.length
      ? ''
      : '<span style="font-size:12px;color:var(--muted)">No custom sites yet — the built-in ATS list is always active.</span>';
    for (const host of sites) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;';
      const name = document.createElement('span');
      name.textContent = host;
      name.style.flex = '1';
      const rm = document.createElement('span');
      rm.textContent = '✕';
      rm.style.cssText = 'cursor:pointer;color:var(--accent);font-weight:600;';
      rm.addEventListener('click', async () => {
        await setSiteOptIn(host, false);
        await renderSites();
      });
      row.append(name, rm);
      list.appendChild(row);
    }
  };
  void renderSites();
  const addSite = async () => {
    const input = $('siteInput') as HTMLInputElement;
    const host = normHost(input.value);
    if (!host || !host.includes('.'))
      return void ($('profileStatus').innerHTML = '<span class="err">Enter a valid domain</span>');
    await setSiteOptIn(host, true);
    input.value = '';
    await renderSites();
  };
  $('siteAdd').addEventListener('click', addSite);
  ($('siteInput') as HTMLInputElement).addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void addSite();
  });
  $('ver').textContent = `v${chrome.runtime.getManifest().version}`;
  const conn = await loadConnection();
  if (conn) {
    ($('token') as HTMLInputElement).value = conn.token;
    renderConn(true, conn.profile?.basics?.name);
  } else {
    renderConn(false); // still enables Import when test mode is on (imports dummy)
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

// ── first-run "Getting started" strip ────────────────────────
// Shown until the user dismisses it (persisted). onInstalled opens this page on first install,
// so this is the first thing a new user reads (onboarding dead-end #1).
const ONBOARDING_KEY = 'jh_onboarding_dismissed';
void (async () => {
  const r = await chrome.storage.local.get(ONBOARDING_KEY);
  if (r[ONBOARDING_KEY] !== true) ($('getstarted') as HTMLElement).hidden = false;
})();
$('gsDismiss').addEventListener('click', () => {
  ($('getstarted') as HTMLElement).hidden = true;
  void chrome.storage.local.set({ [ONBOARDING_KEY]: true });
});
