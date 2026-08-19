import {
  deriveFullProfile,
  type EducationEntry,
  type ExperienceEntry,
  type FullProfile,
  type UserRule,
} from '@jobhakken/autofill';

import { DEFAULT_PROVIDER_ID, getProvider, LLM_PROVIDERS } from '@jobhakken/core/build/llm/providers.js';

import { DEFAULT_BASE } from '../lib/aiClient.js';
import { connect, rpc } from '../lib/bridgeClient.js';
import { clearAiConfig, getAiConfigMeta, getRememberKey, setAiConfig, setRememberKey } from '../lib/aiKeyStore.js';
import { ensureAiHostPermission, hasAiHostPermission } from '../lib/hostPerms.js';
import { ACCOUNT_URL, clearIdentity, loadIdentity, LOGIN_URL } from '../lib/authStore.js';
import { bytesToBase64, clearResumeFile, getResumeFile, setResumeFile } from '../lib/resumeFileStore.js';
import { clearConnection, loadConnection, saveConnection } from '../lib/connectionStore.js';
import { clearCaptures, getCaptures, getOptInSites, setSiteOptIn } from '../lib/captureStore.js';
import { aggregateCorrections, correctionCaptureEnabled } from '../lib/correctionSignal.js';
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
import { resetAllData } from '../lib/resetStore.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Working state (mutated by inputs; persisted on Save).
let fp: FullProfile = { profile: {}, experience: [], education: [], rules: [] };
let testModeOn = false; // extension test toggle (import brings dummy data when on)

void initThemeToggle($('theme')); // manual light/dark toggle (default: follow system)

// ── sidebar + accordion sections ─────────────────────────────
function openSection(key: string | undefined, scroll = true): void {
  if (!key) return;
  document
    .querySelectorAll('.s-item')
    .forEach((s) => s.classList.toggle('active', (s as HTMLElement).dataset.p === key));
  document
    .querySelectorAll('.acc')
    .forEach((a) => a.classList.toggle('collapsed', (a as HTMLElement).dataset.p !== key));
  if (scroll) document.querySelector(`.acc[data-p="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$('side').addEventListener('click', (e) => {
  const it = (e.target as HTMLElement).closest('.s-item') as HTMLElement | null;
  if (it) openSection(it.dataset.p);
});
document.querySelectorAll('.acc-h').forEach((h) => {
  h.addEventListener('click', () => {
    const sec = h.closest('.acc') as HTMLElement;
    if (sec.classList.contains('collapsed')) openSection(sec.dataset.p);
    else sec.classList.add('collapsed'); // clicking the open header closes it
  });
});
// ── ⓘ info tooltips (click toggles; hover handled by CSS) ─────
document.querySelectorAll('.info').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const was = el.classList.contains('open');
    document.querySelectorAll('.info.open').forEach((o) => o.classList.remove('open'));
    if (!was) el.classList.add('open');
  });
});
document.addEventListener('click', () =>
  document.querySelectorAll('.info.open').forEach((o) => o.classList.remove('open')),
);

// ── readiness header (honest: how many profile sections have data) ─
function updateReadiness(): void {
  const keys = ['personal', 'additional', 'education', 'work', 'custom'];
  const segs = $('segbar').children;
  let filled = 0;
  keys.forEach((k, i) => {
    const sec = document.querySelector(`.acc[data-p="${k}"]`);
    let has = false;
    sec?.querySelectorAll('input, textarea, select').forEach((el) => {
      const inp = el as HTMLInputElement;
      if (inp.type === 'checkbox' || inp.type === 'radio') return;
      if (inp.value.trim()) has = true;
    });
    if (has) filled++;
    const seg = segs[i] as HTMLElement | undefined;
    if (seg) seg.className = has ? 'on' : '';
  });
  const pct = Math.round((filled / keys.length) * 100);
  $('readyPct').textContent = filled === keys.length ? "You're all set — 100% ready" : `You're ${pct}% ready to apply`;
  const count = $('readyCount');
  count.textContent = `${filled} / ${keys.length}`;
  count.className = 'pill ' + (filled > 0 ? 'ok' : 'todo');
}
document.addEventListener('input', updateReadiness);

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
    cond.placeholder = 'if the field says… e.g. notice period';
    cond.value = rule.condition ?? '';
    cond.addEventListener('input', () => (rule.condition = cond.value));
    const val = document.createElement('input');
    val.placeholder = 'fill this… e.g. 2 weeks';
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

// ── common custom questions (the "learnings") — one click adds a rule to fill in ──
// Questions autofill can't put on the main profile page but people frequently hit. Clicking a chip
// adds a rule (phrase pre-filled, a sensible suggested answer to edit).
const COMMON_QUESTIONS: { label: string; condition: string; value: string }[] = [
  { label: 'Notice period', condition: 'notice period', value: '2 weeks' },
  { label: 'Earliest start date', condition: 'start date', value: 'Immediately' },
  { label: 'Willing to relocate', condition: 'willing to relocate', value: 'Yes' },
  { label: 'Willing to travel', condition: 'willing to travel', value: 'Yes' },
  { label: 'How did you hear about us', condition: 'how did you hear', value: 'LinkedIn' },
  { label: 'Desired salary', condition: 'desired salary', value: '' },
  { label: 'Current salary', condition: 'current salary', value: '' },
  { label: 'Authorized to work', condition: 'authorized to work', value: 'Yes' },
  { label: 'Require sponsorship', condition: 'require sponsorship', value: 'No' },
  { label: 'Over 18', condition: 'over 18', value: 'Yes' },
  { label: 'Security clearance', condition: 'security clearance', value: 'No' },
  { label: 'Worked here before', condition: 'worked here before', value: 'No' },
  { label: 'Reference name', condition: 'reference name', value: '' },
  { label: 'Reference email', condition: 'reference email', value: '' },
  { label: 'Expected graduation', condition: 'graduation', value: '' },
  { label: 'GPA', condition: 'gpa', value: '' },
  { label: "Driver's license", condition: 'driver', value: 'Yes' },
];
function renderCommonQuestions(): void {
  const box = $('commonQ');
  box.innerHTML = '';
  const existing = new Set((fp.rules ?? []).map((r) => (r.condition ?? '').toLowerCase().trim()));
  for (const q of COMMON_QUESTIONS) {
    const b = document.createElement('button');
    b.textContent = q.label;
    if (existing.has(q.condition.toLowerCase())) {
      b.disabled = true;
      b.title = 'Already added below';
    } else {
      b.addEventListener('click', () => {
        (fp.rules ??= []).push({ condition: q.condition, value: q.value });
        renderRules();
        renderCommonQuestions();
        const inputs = $('ruleList').querySelectorAll('input');
        (inputs[inputs.length - 1] as HTMLInputElement | undefined)?.focus();
      });
    }
    box.appendChild(b);
  }
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
    // ADR-0005: if the app speaks a newer résumé format than we understand, tell the user to update
    // (we still connect — basics/text degrade gracefully).
    if (conn.schemaWarning) {
      $('connStatus').innerHTML += ` <span class="warn">${escapeHtml(conn.schemaWarning)}</span>`;
    }
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

// EEO/demographic keys — a résumé never carries these and we never guess them, so nudge the user to
// set them once (else EEO questions stay blank on applications).
const EEO_KEYS = [
  'gender',
  'pronouns',
  'raceEthnicity',
  'hispanicLatino',
  'veteranStatus',
  'disabilityStatus',
] as const;
function renderEeoNudge(): void {
  const anySet = EEO_KEYS.some((k) => (fp.profile as Record<string, string | undefined>)[k]);
  $('eeoNudge').classList.toggle('hidden', anySet);
}

function renderAll() {
  renderFields('personalGrid', PERSONAL_FIELDS);
  renderFields('additionalGrid', ADDITIONAL_FIELDS);
  renderWork();
  renderEdu();
  renderRules();
  renderCommonQuestions();
  renderEeoNudge();
  updateReadiness();
}
// Hide the nudge live as the user fills an EEO field in the Additional grid.
$('additionalGrid').addEventListener('input', renderEeoNudge);

// Show the résumé file currently stored for attaching to applications (with a remove link).
async function refreshResumeFile(): Promise<void> {
  const el = $('resumeFileInfo');
  const f = await getResumeFile();
  if (f) {
    el.innerHTML = `📎 Attached to applications: <b>${escapeHtml(f.fileName)}</b> <a href="#" id="resumeFileRemove">remove</a>`;
    el.classList.remove('hidden');
    $('resumeFileRemove').addEventListener('click', async (e) => {
      e.preventDefault();
      await clearResumeFile();
      await refreshResumeFile();
    });
  } else {
    el.classList.add('hidden');
    el.innerHTML = '';
  }
}
void refreshResumeFile();

// ── AI résumé-input: paste text → parse to profile via the BYO key (no desktop) ──
// Upload PDF → extract text (dependency-free) into the textarea for review, then Parse.
$('resumePdf').addEventListener('change', async (e) => {
  const file = (e.currentTarget as HTMLInputElement).files?.[0];
  if (!file) return;
  const status = $('resumeStatus');
  const name = file.name.toLowerCase();
  const isDocx = name.endsWith('.docx') || file.type.includes('wordprocessingml');
  if (name.endsWith('.doc') && !isDocx) {
    status.innerHTML =
      '<span class="warn">The old .doc format isn’t supported — save it as PDF or .docx, or paste the text.</span>';
    (e.currentTarget as HTMLInputElement).value = '';
    return;
  }
  status.innerHTML = `<span class="note">Reading ${isDocx ? 'Word doc' : 'PDF'}…</span>`;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Keep the file to ATTACH to applications — standalone/BYO users have no desktop app to provide it.
    await setResumeFile({
      base64: bytesToBase64(bytes),
      fileName: file.name,
      mimeType:
        file.type ||
        (isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf'),
    });
    await refreshResumeFile();
    const text = isDocx
      ? await (await import('../lib/docxText.js')).extractDocxText(bytes)
      : await (await import('../lib/pdfText.js')).extractPdfText(bytes);
    if (text.length < 40) {
      status.innerHTML = `<span class="warn">Saved to attach to applications, but couldn’t read its text (it may be scanned) — paste the text so AI can fill your profile.</span>`;
      return;
    }
    ($('resumeText') as HTMLTextAreaElement).value = text;
    status.innerHTML = `<span class="ok">Read ${text.length.toLocaleString()} characters · this file will be attached to applications — review, then Parse with AI.</span>`;
  } catch {
    status.innerHTML = '<span class="warn">Couldn’t read this file. Paste the text instead.</span>';
  } finally {
    (e.currentTarget as HTMLInputElement).value = ''; // allow re-selecting the same file
  }
});

$('resumeParse').addEventListener('click', async () => {
  const text = ($('resumeText') as HTMLTextAreaElement).value.trim();
  const status = $('resumeStatus');
  if (text.length < 40) {
    status.innerHTML = '<span class="warn">Paste your résumé text first.</span>';
    return;
  }
  const btn = $('resumeParse') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Parsing…';
  status.textContent = '';
  const res = (await chrome.runtime.sendMessage({ type: 'f2a-ai', method: 'parseResume', params: { text } })) as
    | {
        result?: { parsed?: { profile?: Record<string, string>; experience?: unknown[]; education?: unknown[] } };
        error?: string;
      }
    | undefined;
  btn.disabled = false;
  btn.textContent = 'Parse with AI';
  if (res?.error) {
    status.innerHTML =
      res.error === 'no-key'
        ? '<span class="warn">Add your AI key first (Settings → AI drafting).</span>'
        : `<span class="warn">Couldn’t parse: ${escapeHtml(res.error)}</span>`;
    return;
  }
  const parsed = res?.result?.parsed;
  if (!parsed || (!Object.keys(parsed.profile ?? {}).length && !(parsed.experience ?? []).length)) {
    status.innerHTML = '<span class="warn">Nothing extracted — check the pasted text.</span>';
    return;
  }
  // Merge: parsed résumé fills/overrides the profile fields + experience/education; keep custom rules.
  fp = {
    profile: { ...fp.profile, ...(parsed.profile as FullProfile['profile']) },
    experience: (parsed.experience?.length ? parsed.experience : fp.experience) as FullProfile['experience'],
    education: (parsed.education?.length ? parsed.education : fp.education) as FullProfile['education'],
    rules: fp.rules,
  };
  composeFullName();
  renderAll();
  await saveFullProfile(fp);
  const nF = Object.keys(parsed.profile ?? {}).length;
  const eeoMissing = !EEO_KEYS.some((k) => (fp.profile as Record<string, string | undefined>)[k]);
  const eeoNote = eeoMissing
    ? ' A résumé has no demographic/EEO info — set those in the <b>Additional</b> tab so those questions autofill too (we never guess them).'
    : '';
  status.innerHTML = `<span class="ok">✓ Filled ${nF} field${nF === 1 ? '' : 's'}, ${parsed.experience?.length ?? 0} role(s), ${parsed.education?.length ?? 0} school(s) — review below.</span>${eeoNote}`;
});

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

  // §6 dev correction report — gated behind a dev flag AND Demo mode (dummy identity); never a real user.
  const DEV_CORR = 'jh_dev_correction';
  void chrome.storage.local.get(DEV_CORR).then((r) => {
    ($('devCorrection') as HTMLInputElement).checked = r[DEV_CORR] === true;
  });
  $('devCorrection').addEventListener('change', (e) => {
    void chrome.storage.local.set({ [DEV_CORR]: (e.currentTarget as HTMLInputElement).checked });
  });
  $('correctionReport').addEventListener('click', async () => {
    const note = $('correctionNote');
    if (!(await correctionCaptureEnabled())) {
      note.textContent = 'Turn on this checkbox AND Demo mode first.';
      return;
    }
    const ranked = aggregateCorrections(await getCaptures());
    if (!ranked.length) return void (note.textContent = 'No captures yet.');
    const blob = new Blob([JSON.stringify(ranked, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jobhakken-corrections-${ranked.length}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    note.textContent = `${ranked.length} field signatures ranked (worst gaps first).`;
  });

  // Danger zone — full local reset (wipes everything except the desktop-app connection). Two-click
  // confirm so a stray click can't erase the user's profile/résumé/AI key/sign-in.
  let resetArmed = false;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  $('resetData').addEventListener('click', async () => {
    const btn = $('resetData') as HTMLButtonElement;
    const status = $('resetStatus');
    if (!resetArmed) {
      resetArmed = true;
      btn.textContent = 'Click again to erase everything';
      status.innerHTML =
        '<span class="warn">Wipes your profile, résumé, answers, AI key &amp; sign-in — keeps only the desktop-app link.</span>';
      resetTimer = setTimeout(() => {
        resetArmed = false;
        btn.textContent = 'Reset extension data…';
        status.textContent = '';
      }, 5000);
      return;
    }
    if (resetTimer) clearTimeout(resetTimer);
    btn.disabled = true;
    await resetAllData();
    status.innerHTML = '<span class="ok">✓ Everything reset. Reloading…</span>';
    setTimeout(() => location.reload(), 700);
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

// ── Sign in (identity) — reuses the website's auth; the auth content script reports back ──
async function refreshAuth(): Promise<void> {
  const id = await loadIdentity();
  ($('authStatus') as HTMLElement).innerHTML = id
    ? `<span class="ok">✓ Signed in as ${escapeHtml(id.email)}${id.tier ? ` · ${escapeHtml(id.tier)}` : ''}</span>`
    : '';
  ($('signOut') as HTMLButtonElement).hidden = !id;
  ($('signIn') as HTMLButtonElement).textContent = id ? 'Switch account' : 'Sign in with JobHakken';
  // Persistent masthead chip — reflects login on every section.
  const chip = $('authChip');
  chip.classList.toggle('in', !!id);
  ($('authChipLabel') as HTMLElement).textContent = id ? id.email : 'Sign in';
  chip.title = id
    ? `Signed in as ${id.email}${id.tier ? ` · ${id.tier}` : ''} — manage account`
    : 'Sign in to JobHakken (unlocks managed AI + H-1B insights)';
  // Signed-out "unlock" hero on Home — hidden once signed in or dismissed.
  const heroDismissed = (await chrome.storage.local.get('f2a_signin_hero')).f2a_signin_hero === true;
  ($('signinHero') as HTMLElement).hidden = !!id || heroDismissed;
}
// Masthead chip: signed out → open login; signed in → open the account page.
$('authChip').addEventListener('click', (e) => {
  e.preventDefault();
  void loadIdentity().then((id) => chrome.tabs.create({ url: id ? ACCOUNT_URL : LOGIN_URL }));
});
$('signinHeroCta').addEventListener('click', () => {
  void chrome.tabs.create({ url: LOGIN_URL });
});
$('signinHeroDismiss').addEventListener('click', () => {
  ($('signinHero') as HTMLElement).hidden = true;
  void chrome.storage.local.set({ f2a_signin_hero: true });
});
$('signIn').addEventListener('click', () => {
  void chrome.tabs.create({ url: LOGIN_URL });
  ($('authStatus') as HTMLElement).innerHTML =
    '<span class="note">Finish signing in on the JobHakken tab — this updates automatically.</span>';
});
$('signOut').addEventListener('click', async () => {
  await clearIdentity();
  await refreshAuth();
});
// Live-update when the auth content script writes the identity after the user logs in on the website.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'f2a_identity' in changes) void refreshAuth();
});
void refreshAuth();

// ── BYO AI key (standalone AI, no desktop) — provider picker from @jobhakken/core (#115) ───────────
// The registry is the single source of truth (shared with desktop); we render it, never fork it. All
// adapters are supported: OpenAI-compatible reuse the existing aiClient; Anthropic + Gemini route
// through core's native clients (aiClient handles the MV3-CORS specifics — #115 phase 2).
const KNOWN_PROVIDER_IDS = new Set(LLM_PROVIDERS.map((p) => p.id));
/** apiKeyless local runtimes (Ollama/LM Studio/Codex) still need a non-empty apiKey for the config to
 *  be considered "active" (getAiConfig returns null on an empty key) — send a harmless sentinel the
 *  local server ignores. */
const LOCAL_SENTINEL_KEY = 'local';

function populateProviders(): void {
  const sel = $('aiProvider') as HTMLSelectElement;
  if (sel.options.length) return; // build once
  for (const p of LLM_PROVIDERS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => applyProvider(sel.value, true));
}

/** Reflect a provider preset in the fields. `userPicked` prefills model/base from the preset (a fresh
 *  choice); on initial load we pass false so the user's saved model/base overrides survive. */
function applyProvider(id: string, userPicked: boolean): void {
  const p = getProvider(id);
  const isCustom = p.id === 'custom';
  ($('aiKeyRow') as HTMLElement).hidden = !!p.apiKeyless; // local runtimes need no key
  ($('aiKeyLabel') as HTMLElement).textContent = p.apiKeyLabel ?? 'API key';
  ($('aiBaseRow') as HTMLElement).hidden = !isCustom; // only "custom" exposes the base URL
  if (userPicked) {
    ($('aiModel') as HTMLInputElement).value = p.defaultModel;
    ($('aiBase') as HTMLInputElement).value = isCustom ? '' : (p.baseUrl ?? '');
  }
  const hint = $('aiHint');
  hint.textContent = p.hint ?? '';
  if (p.docsUrl && !p.apiKeyless && p.docsUrl.startsWith('https://')) {
    const a = document.createElement('a');
    a.href = p.docsUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `${hint.textContent ? ' · ' : ''}Get a key ↗`;
    hint.appendChild(a);
  }
}

async function refreshAi(): Promise<void> {
  populateProviders();
  const m = await getAiConfigMeta();
  const sel = $('aiProvider') as HTMLSelectElement;
  const savedId = m.provider || DEFAULT_PROVIDER_ID;
  sel.value = KNOWN_PROVIDER_IDS.has(savedId) ? savedId : DEFAULT_PROVIDER_ID;
  applyProvider(sel.value, false); // toggles + labels, but keep saved overrides below
  const p = getProvider(sel.value);
  ($('aiModel') as HTMLInputElement).value = m.model || p.defaultModel;
  ($('aiBase') as HTMLInputElement).value = m.baseUrl || (p.id === 'custom' ? '' : (p.baseUrl ?? ''));
  const status = $('aiStatus') as HTMLElement;
  if (m.hasKey) {
    // BYOK provider hosts are optional permissions — if the grant is missing, AI calls fail, so nudge
    // the user to re-Save (which requests it). Local endpoints need no grant.
    const granted = await hasAiHostPermission(m.baseUrl || p.baseUrl || DEFAULT_BASE);
    status.textContent = granted
      ? '✓ Active this session'
      : '⚠ Active — click Save to grant browser access to your AI provider.';
  } else {
    status.textContent = '';
  }
  ($('aiClear') as HTMLButtonElement).hidden = !m.hasKey;
}

void (async () => {
  ($('aiRemember') as HTMLInputElement).checked = await getRememberKey();
})();
$('aiRemember').addEventListener('change', async (e) => {
  await setRememberKey((e.currentTarget as HTMLInputElement).checked);
  await refreshAi();
});
$('aiSave').addEventListener('click', async () => {
  const sel = $('aiProvider') as HTMLSelectElement;
  const p = getProvider(sel.value);
  const status = $('aiStatus') as HTMLElement;
  const model = ($('aiModel') as HTMLInputElement).value.trim();
  const typedKey = ($('aiKey') as HTMLInputElement).value.trim();
  // Custom → user-supplied base URL; every other preset → its registry baseUrl.
  const baseUrl = p.id === 'custom' ? ($('aiBase') as HTMLInputElement).value.trim() : (p.baseUrl ?? '');
  if (p.id === 'custom' && !baseUrl) {
    status.textContent = 'Enter the endpoint base URL';
    return;
  }
  if (!p.apiKeyless && !typedKey) {
    status.textContent = `Enter your ${p.apiKeyLabel ?? 'API key'} first`;
    return;
  }
  const apiKey = p.apiKeyless ? LOCAL_SENTINEL_KEY : typedKey;
  await setRememberKey(($('aiRemember') as HTMLInputElement).checked);
  await setAiConfig({ apiKey, model: model || undefined, baseUrl: baseUrl || undefined, provider: p.id });
  ($('aiKey') as HTMLInputElement).value = '';
  // Request browser access to the chosen provider now (BYOK hosts are OPTIONAL — kept out of the
  // default install; see hostPerms.ts). This click is the user gesture Chrome needs for the prompt.
  const outcome = await ensureAiHostPermission(baseUrl || DEFAULT_BASE);
  await refreshAi();
  if (outcome === 'denied') {
    status.textContent = '✓ Saved — but browser access to the provider was denied. Click Save to grant it.';
  } else if (outcome === 'unsupported') {
    status.textContent = '✓ Saved. That endpoint needs manual permission — use a listed provider or a local endpoint.';
  }
});
$('aiClear').addEventListener('click', async () => {
  await clearAiConfig();
  ($('aiModel') as HTMLInputElement).value = '';
  ($('aiBase') as HTMLInputElement).value = '';
  await refreshAi();
});
void refreshAi();

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

// ── Back up & restore (#143) ───────────────────────────────────────────────────────────────────────
// This lives in Options, not in the page rail. The rail runs in a CONTENT SCRIPT, which is severed the
// moment the extension reloads — `chrome.storage` then reads as undefined and any click throws
// "Cannot read properties of undefined (reading 'local')". An extension page cannot be orphaned that
// way, and backup/restore is account-level anyway: it is not per-site, and not part of filling a form.
import { backupFileName, describeBackup, exportBackup, importBackup } from '../lib/backup.js';

$('backupExport').addEventListener('click', async () => {
  const status = $('backupStatus');
  try {
    const b = await exportBackup();
    const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName(b);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    status.textContent = describeBackup(b);
  } catch (e) {
    status.textContent = e instanceof Error ? e.message : 'Could not save a backup';
  }
});

// The file input is created on demand rather than living in the markup: this section sits inside a
// collapsed accordion (`.acc.collapsed .acc-b { display: none }`), and Chrome will not open a file
// dialog for an input with a display:none ancestor. A detached element has no such problem.
$('backupImport').addEventListener('click', () => {
  const status = $('backupStatus');
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const r = await importBackup(JSON.parse(await f.text()) as unknown);
      status.textContent = `Restored ${r.restored} item${r.restored === 1 ? '' : 's'}${
        r.skipped.length ? `, skipped ${r.skipped.length}` : ''
      }. Reload this page to see it.`;
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Could not read that file';
    }
  });
  inp.click();
});
