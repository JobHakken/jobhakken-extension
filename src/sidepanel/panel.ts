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
  memo?: { host: string; at: number; uses: number; promoted?: boolean };
  asked?: { hits: number; of: number };
  addable?: boolean;
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

/** How many uses before we ASK about promoting. Not a promotion threshold — nothing self-promotes. */
const ASK_AFTER = 3;

/** Rows shown before the Filled group collapses. */
const COLLAPSE_AT = 6;
const expanded = new Set<string>();

/**
 * An open-ended question — a free-text answer no profile field can supply ("what draws you to this
 * role?"). Those are the only rows where AI drafting earns its cost; a dropdown or a short text field
 * has a right answer we should either know or ask for.
 */
function isOpenQuestion(r: PanelRow): boolean {
  if (r.consequential) return false; // never draft an answer to something legally consequential
  return r.kind === 'textarea' || (r.kind === 'text' && r.label.length > 45);
}

const when = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function rowHtml(r: PanelRow): string {
  const has = !!r.value;
  const shown = r.value || r.current;
  // A row only offers Fill when we have something to put there AND the page doesn't already hold it.
  const canFill = has && r.current.trim() !== r.value.trim();
  const sig = esc(r.signature);

  // Provenance / reason line, in priority order: the promotion ask, then memory provenance, then the
  // reason we declined, then how often this question comes up.
  let foot = '';
  if (r.memo && !r.memo.promoted && r.memo.uses >= ASK_AFTER) {
    foot = `<span class="src promote-ask">you've used this ${r.memo.uses}× — always fill it?
      <button class="yes" data-act="promote" data-sig="${sig}">Always</button>
      <button data-act="dismiss" data-sig="${sig}">Keep asking</button></span>`;
  } else if (r.memo?.promoted) {
    foot = `<span class="src">you wrote this · always filled</span>`;
  } else if (r.memo) {
    foot = `<span class="src">you wrote this · ${esc(when(r.memo.at))} · ${esc(r.memo.host.replace(/^www\./, '').split('.')[0])}</span>`;
  } else if (r.why) {
    foot = `<span class="why">${esc(r.why)}</span>`;
  }
  if (r.asked && !r.memo) {
    foot += `<span class="src">asked on ${r.asked.hits} of your last ${r.asked.of} applications</span>`;
  }

  return `<div class="row${r.memo && !r.memo.promoted && r.memo.uses >= ASK_AFTER ? ' promote' : ''}" data-sig="${sig}">
    <span class="k">${esc(r.label || '(unlabelled field)')}</span>
    <span class="v">
      <span class="val${shown ? '' : ' none'}">${shown ? esc(shown) : 'nothing to put here'}</span>
      ${r.consequential ? '<span class="warn" title="A wrong answer here costs you something">!</span>' : ''}
      <span class="type">${esc(r.kind)}</span>
      ${canFill ? `<button class="fill" data-act="fill" data-sig="${sig}">Fill</button>` : ''}
      ${has && !canFill ? `<button data-act="copy" data-sig="${sig}">Copy</button>` : ''}
      ${!has && r.addable ? `<button data-act="add" data-sig="${sig}">Add</button>` : ''}
      ${!has && !r.addable && isOpenQuestion(r) ? `<button class="draft" data-act="draft" data-sig="${sig}">✍ Draft 2</button>` : ''}
    </span>
    ${foot}
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
    .map((g) => {
      const list = by(g);
      // A long Filled list is reference material, not something to scroll past to reach what needs you.
      // Collapse it so 'need you' and 'remembered' stay above the fold.
      const cut = g === 'know' && list.length > COLLAPSE_AT && !expanded.has(g);
      const shown = cut ? list.slice(0, COLLAPSE_AT) : list;
      return (
        `<section class="grp ${g}"><h2><span>${GROUP_TITLES[g]}</span><span class="n">${list.length}</span></h2>` +
        shown.map(rowHtml).join('') +
        (cut ? `<div class="more" data-more="${g}">+ ${list.length - COLLAPSE_AT} more filled</div>` : '') +
        `</section>`
      );
    })
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
  // Filling FROM memory is the signal the promotion prompt reads (#144). Only count a real success.
  if (res.filled && row.memo) {
    await rpc('noteUse', { label: row.label });
    await refresh(); // may now cross ASK_AFTER and surface the "always fill it?" prompt
  }
}

/** Ask for two options for one question and render them under the row for the user to choose. */
async function draftRow(sig: string): Promise<void> {
  const row = rows.find((r) => r.signature === sig);
  const el = document.querySelector<HTMLElement>(`.row[data-sig="${CSS.escape(sig)}"]`);
  if (!row || !el) return;
  el.querySelector('.variants,.drafting')?.remove();
  el.insertAdjacentHTML('afterend', '<div class="drafting">drafting two options — one call…</div>');
  const box = el.nextElementSibling;
  const res = (await rpc<{ options: string[]; error?: string }>('draftTwo', { label: row.label })) ?? {
    options: [],
    error: 'no answer',
  };
  if (!box) return;
  if (!res.options.length) {
    box.className = 'drafting';
    box.textContent = res.error ?? 'nothing came back — try again';
    return;
  }
  const titles = ['Option A · concise', 'Option B · specific'];
  box.className = 'variants';
  box.innerHTML = res.options
    .map(
      (o, i) =>
        `<div class="variant"><div class="vh"><span class="vt">${esc(titles[i] ?? 'Option')}</span>` +
        `<button class="use" data-act="usedraft" data-sig="${esc(sig)}" data-i="${i}">Fill</button></div>` +
        `<p>${esc(o)}</p></div>`,
    )
    .join('');
  drafted.set(sig, res.options);
}

/** Drafts held per row until the user picks one. */
const drafted = new Map<string, string[]>();

/**
 * Fill a chosen draft, then BANK it. That's the loop that matters: what the user accepted becomes a
 * remembered answer, so the same question never costs another model call.
 */
async function useDraft(sig: string, i: number): Promise<void> {
  const row = rows.find((r) => r.signature === sig);
  const text = drafted.get(sig)?.[i];
  if (!row || !text) return;
  const res = (await rpc<FillResult>('fillOne', { signature: sig, value: text })) ?? { filled: false };
  markRow(sig, res);
  if (res.filled) {
    await rpc('learnFromPage'); // the page now holds it → banked as the user's own answer
    await refresh();
  }
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

/**
 * Site insight — everything structure capture holds for this host, rendered verbatim.
 *
 * This view IS the disclosure for always-on capture (#141/#142): what's stored is exactly what's on
 * screen — question, control kind, how many recent forms asked it — and there are no answers in it to
 * hide. That's auditable by the user, which a policy paragraph is not.
 */
async function showInsight(): Promise<void> {
  const d = await rpc<{ host: string; rows: { q: string; kind: string; seen: number }[] }>('siteInsight');
  const groups = $('groups');
  $('ctx').textContent = d ? `learned on ${d.host}` : 'no page';
  $('tally').innerHTML = '';
  $<HTMLButtonElement>('fillAll').hidden = true;
  $('note').textContent = 'structure only · no answers stored here';
  if (!d?.rows.length) {
    groups.innerHTML = `<p class="empty"><b>Nothing learned yet</b>Open a few applications and the questions they ask will collect here.</p>`;
    return;
  }
  groups.innerHTML =
    `<table class="insight"><thead><tr><th>Question</th><th>Type</th><th class="n">Seen</th></tr></thead><tbody>` +
    d.rows
      .map(
        (r) =>
          `<tr><td>${esc(r.q)}</td><td><span class="type">${esc(r.kind)}</span></td><td class="n">${r.seen}</td></tr>`,
      )
      .join('') +
    `</tbody></table>`;
}

let showingInsight = false;

async function refresh(): Promise<void> {
  if (showingInsight) {
    await showInsight();
    return;
  }
  render(await rpc<PanelData>('panelFields'));
}

/**
 * Bank anything the user typed by hand, then re-read. This is the "learn by doing" half: a question we
 * declined to answer becomes a remembered answer the moment the user answers it themselves, and it will
 * be offered on the next form that asks the same thing — on any site.
 */
async function learnThenRefresh(): Promise<void> {
  await rpc<{ learned: number }>('learnFromPage');
  await refresh();
}

// One delegated listener: rows are re-rendered wholesale, so per-button listeners would leak.
$('groups').addEventListener('click', (e) => {
  const more = (e.target as HTMLElement).closest<HTMLElement>('[data-more]');
  if (more) {
    expanded.add(more.dataset.more ?? '');
    void refresh();
    return;
  }
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-sig]');
  if (!btn) return;
  const sig = btn.dataset.sig ?? '';
  const row = rows.find((r) => r.signature === sig);
  switch (btn.dataset.act) {
    case 'fill':
      void fillRow(sig);
      break;
    case 'promote':
      // Explicit, user-initiated promotion. Nothing here ever happens on its own.
      if (row) void rpc('promote', { label: row.label, on: true }).then(() => refresh());
      break;
    case 'dismiss':
      // "Keep asking" — leave it an offer. We simply stop nagging this session.
      btn.closest('.row')?.classList.remove('promote');
      btn.closest('.src')?.remove();
      break;
    case 'draft':
      void draftRow(sig);
      break;
    case 'usedraft':
      void useDraft(sig, Number(btn.dataset.i ?? 0));
      break;
    case 'add':
      // Send them to the profile field that would answer this permanently.
      void chrome.runtime.openOptionsPage();
      break;
    default:
      void copyRow(sig);
  }
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

$('insight').addEventListener('click', () => {
  showingInsight = !showingInsight;
  $('insight').textContent = showingInsight ? '◑' : '◔';
  void refresh();
});

void initTheme();
// Re-read when the user switches tabs or navigates — the panel persists across both, so without this
// it would keep showing the previous page's fields.
chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === 'complete') void refresh();
});
// Learn when the panel regains focus: the user has typically just been typing in the form.
window.addEventListener('focus', () => void learnThenRefresh());
void learnThenRefresh();
