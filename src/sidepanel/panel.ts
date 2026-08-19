/**
 * Side panel (#140) — the three-state view of the form in front of you: what we filled, what we're
 * handing back, and what you taught us before.
 *
 * Why a panel at all: the shift to precision-first (#139) means we deliberately decline to fill
 * anything we can't stand behind. That only helps if the thing we declined is one click away instead
 * of a dead end — which is what this surface is for. It sits alongside the popup rather than replacing
 * it; the popup keeps the quick single-click fill, H-1B and the bug report.
 *
 * Every write is user-initiated. Clicking **Fill** IS the confirmation, which is exactly why the panel
 * can offer a value it would refuse to place unprompted (#145).
 */
import { bestFrameId } from '../lib/frameStore.js';
import { escapeHtml as esc } from '../lib/html.js';
import { initTheme } from '../lib/theme.js';

type Group = 'know' | 'ask' | 'remember';
type PanelRow = {
  signature: string;
  label: string;
  kind: string;
  group: Group;
  value: string;
  current: string;
  source: string | null;
  why?: string;
  consequential: boolean;
};
type PanelData = { rows: PanelRow[]; ats: string | null; host: string };
type FillResult = { filled: boolean; reason?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Ask the active tab's content script for something.
 *
 * Mirrors the popup's RPC including the reconnect: a panel is typically left OPEN across an extension
 * reload, which is precisely when Chrome leaves the page's content script running but severed (#150).
 * Without the retry the panel sits empty on a page it can read perfectly well.
 */
async function rpc<T>(method: string, params?: unknown): Promise<T | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const id = tab?.id;
  if (id == null) return null;
  const send = async (fid: number | null | undefined) =>
    (await chrome.tabs.sendMessage(id, { type: 'f2a-rpc', method, params }, fid != null ? { frameId: fid } : {})) as T;
  try {
    return await send(await bestFrameId(id));
  } catch {
    const ok = await chrome.runtime
      .sendMessage({ type: 'f2a-reinject', tabId: id })
      .then((r: { ok?: boolean } | undefined) => !!r?.ok)
      .catch(() => false);
    if (!ok) return null;
    try {
      return await send(null); // the remembered frameId belonged to the dead injection
    } catch {
      return null;
    }
  }
}

let rows: PanelRow[] = [];

const GROUP_TITLES: Record<Group, string> = {
  know: 'Filled — high confidence',
  ask: "Need you — we won't guess",
  remember: 'Remembered from you',
};

/**
 * The ATS name is a CLAIM (#148): name a platform only where we have tested handling for it, and say
 * "generic handling" otherwise rather than implying support we haven't verified.
 *
 * PROVISIONAL — this list is hardcoded scaffolding. #148 must derive it from which precision fixtures
 * actually pass, or the badge becomes exactly the unearned promise it exists to avoid.
 */
const TESTED: Record<string, string> = {
  greenhouse: 'react-select · file upload',
  lever: 'native selects · file upload',
  ashby: 'react widgets · file upload',
  workable: 'native selects',
  recruitee: 'native selects',
  successfactors: 'native selects',
  bamboohr: 'iframed form',
};

function renderBadge(d: PanelData): void {
  const badge = $('badge');
  const name = $('badgeName');
  const sub = $('badgeSub');
  const tested = d.ats ? TESTED[d.ats] : undefined;
  if (d.ats && tested) {
    badge.className = 'badge named';
    name.textContent = d.ats.charAt(0).toUpperCase() + d.ats.slice(1);
    sub.textContent = tested;
  } else if (d.ats) {
    badge.className = 'badge';
    name.textContent = 'Generic handling';
    sub.textContent = `${d.ats} · not yet verified`;
  } else {
    badge.className = 'badge';
    name.textContent = 'Unknown site';
    sub.textContent = 'nothing claimed';
  }
}

function rowHtml(r: PanelRow): string {
  const has = !!r.value;
  const shown = r.value || r.current;
  // A row only offers Fill when we have something to put there AND the page doesn't already hold it.
  const canFill = has && r.current.trim() !== r.value.trim();
  return `<div class="row" data-sig="${esc(r.signature)}">
    <span class="k">${esc(r.label || '(unlabelled field)')}</span>
    <span class="v">
      <span class="val${shown ? '' : ' none'}">${shown ? esc(shown) : 'nothing to put here'}</span>
      ${r.consequential ? '<span class="warn" title="A wrong answer here costs you something">!</span>' : ''}
      <span class="type">${esc(r.kind)}</span>
      ${canFill ? `<button class="fill" data-act="fill" data-sig="${esc(r.signature)}">Fill</button>` : ''}
      ${has && !canFill ? `<button data-act="copy" data-sig="${esc(r.signature)}">Copy</button>` : ''}
    </span>
    ${r.why ? `<span class="why">${esc(r.why)}</span>` : ''}
  </div>`;
}

function render(d: PanelData | null): void {
  const groups = $('groups');
  const fillAll = $<HTMLButtonElement>('fillAll');
  if (!d) {
    $('ctx').textContent = 'no page';
    $('tally').innerHTML = '';
    $('note').textContent = '';
    fillAll.hidden = true;
    groups.innerHTML = `<p class="empty"><b>Nothing to read here</b>Open a job application and this panel will list its fields.</p>`;
    return;
  }
  rows = d.rows;
  renderBadge(d);
  $('ctx').textContent = `this form · ${d.rows.length} field${d.rows.length === 1 ? '' : 's'}`;

  const by = (g: Group) => d.rows.filter((r) => r.group === g);
  const n = { know: by('know').length, ask: by('ask').length, remember: by('remember').length };
  $('tally').innerHTML =
    (n.know ? `<span class="chip k">${n.know} filled</span>` : '') +
    (n.ask ? `<span class="chip a">${n.ask} need you</span>` : '') +
    (n.remember ? `<span class="chip r">${n.remember} remembered</span>` : '');

  if (!d.rows.length) {
    fillAll.hidden = true;
    $('note').textContent = '';
    groups.innerHTML = `<p class="empty"><b>No form fields found</b>This page doesn't look like an application form.</p>`;
    return;
  }

  const pending = d.rows.filter((r) => r.value && r.current.trim() !== r.value.trim());
  fillAll.hidden = pending.length === 0;
  fillAll.textContent = `Fill ${pending.length} field${pending.length === 1 ? '' : 's'}`;
  $('note').textContent = n.ask ? `${n.ask} left for you on purpose` : 'learning from this form';

  groups.innerHTML = (['know', 'remember', 'ask'] as Group[])
    .filter((g) => by(g).length)
    .map(
      (g) =>
        `<section class="grp ${g}"><h2><span>${GROUP_TITLES[g]}</span><span class="n">${by(g).length}</span></h2>` +
        by(g).map(rowHtml).join('') +
        `</section>`,
    )
    .join('');
}

/** Mark a row's outcome in place. Honest about failure: a widget we can't drive says so. */
function markRow(sig: string, res: FillResult): void {
  const el = document.querySelector<HTMLElement>(`.row[data-sig="${CSS.escape(sig)}"]`);
  if (!el) return;
  const btn = el.querySelector<HTMLButtonElement>('button[data-act="fill"]');
  if (res.filled) {
    el.classList.add('done');
    if (btn) {
      btn.textContent = 'Filled';
      btn.disabled = true;
    }
    return;
  }
  // Couldn't write it — offer the copy path instead of pretending. The content script has already
  // scrolled the field into view.
  if (btn) {
    btn.textContent = 'Copy';
    btn.dataset.act = 'copy';
    btn.className = 'copy';
  }
  const why = el.querySelector('.why');
  const msg =
    res.reason === 'widget'
      ? "this control won't take a pasted value — copy it and we've scrolled to the field"
      : res.reason === 'gone'
        ? 'the page changed — refresh the panel'
        : 'could not fill this one';
  if (why) why.textContent = msg;
  else el.insertAdjacentHTML('beforeend', `<span class="why">${esc(msg)}</span>`);
}

async function fillRow(sig: string): Promise<void> {
  const row = rows.find((r) => r.signature === sig);
  if (!row) return;
  const btn = document.querySelector<HTMLButtonElement>(`button[data-act="fill"][data-sig="${CSS.escape(sig)}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '…';
  }
  const res = (await rpc<FillResult>('fillOne', { signature: sig, value: row.value })) ?? {
    filled: false,
    reason: 'error',
  };
  if (btn) btn.disabled = false;
  markRow(sig, res);
}

async function copyRow(sig: string): Promise<void> {
  const row = rows.find((r) => r.signature === sig);
  if (!row?.value) return;
  try {
    await navigator.clipboard.writeText(row.value);
    const btn = document.querySelector<HTMLButtonElement>(`button[data-sig="${CSS.escape(sig)}"]`);
    if (btn) {
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = 'Copy'), 1200);
    }
  } catch {
    /* clipboard denied — the value is on screen to select by hand */
  }
}

async function refresh(): Promise<void> {
  render(await rpc<PanelData>('panelFields'));
}

// One delegated listener: rows are re-rendered wholesale, so per-button listeners would leak.
$('groups').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-sig]');
  if (!btn) return;
  const sig = btn.dataset.sig ?? '';
  if (btn.dataset.act === 'fill') void fillRow(sig);
  else void copyRow(sig);
});

$<HTMLButtonElement>('fillAll').addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  const before = btn.textContent;
  btn.textContent = 'Filling…';
  // Sequential, not parallel: these drive real widgets (opening menus, dispatching clicks), and
  // racing them is what produced the churn users saw as the page jumping around (#136).
  for (const r of rows.filter((x) => x.value && x.current.trim() !== x.value.trim())) {
    const res = (await rpc<FillResult>('fillOne', { signature: r.signature, value: r.value })) ?? {
      filled: false,
      reason: 'error',
    };
    markRow(r.signature, res);
  }
  btn.textContent = before;
  btn.disabled = false;
  await refresh(); // re-read the page so the counts reflect what actually landed
});

void initTheme();
// Re-read when the user switches tabs or navigates — the panel persists across both, so without this
// it would keep showing the previous page's fields.
chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === 'complete') void refresh();
});
void refresh();
