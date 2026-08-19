/**
 * Side panel (#140) — the three-state view of the form in front of you: what we filled, what we're
 * handing back, and what you taught us before.
 *
 * Why a panel at all: the shift to precision-first (#139) means we deliberately decline to fill
 * anything we can't stand behind. That only helps if the thing we declined is one click away instead
 * of a dead end — which is what this surface is for. It sits alongside the popup rather than replacing
 * it; the popup keeps the quick single-click fill, H-1B and the bug report.
 *
 * Read-only in this first cut: it resolves and explains, and does not write to the page. Click-to-fill
 * is #145.
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

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Ask the active tab's content script for the field list.
 *
 * Mirrors the popup's RPC exactly, including the reconnect: a panel is typically left OPEN across an
 * extension reload, which is precisely when Chrome leaves the page's content script running but
 * severed (#150). Without the retry the panel would sit empty on a page it can read perfectly well.
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

const GROUPS: { id: Group; title: string; hint: string }[] = [
  { id: 'know', title: 'Filled — high confidence', hint: '' },
  { id: 'ask', title: "Need you — we won't guess", hint: '' },
  { id: 'remember', title: 'Remembered from you', hint: '' },
];

function rowHtml(r: PanelRow): string {
  const shown = r.value || r.current;
  return `<div class="row">
    <span class="k">${esc(r.label)}</span>
    <span class="v">
      <span>${shown ? esc(shown) : '<em>—</em>'}</span>
      <span class="type">${esc(r.kind)}</span>
    </span>
    ${r.why ? `<span class="why">${esc(r.why)}</span>` : ''}
  </div>`;
}

/**
 * The ATS name is a CLAIM (#148): we only name a platform when we have tested handling for it. Until
 * a precision fixture licenses that claim, say "generic handling" rather than implying support we have
 * not verified — Workday today being the honest example.
 */
const TESTED = new Set(['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'successfactors', 'bamboohr']);

function renderBadge(d: PanelData): void {
  const badge = $('badge');
  const name = $('badgeName');
  if (d.ats && TESTED.has(d.ats)) {
    badge.className = 'badge named';
    name.textContent = d.ats.charAt(0).toUpperCase() + d.ats.slice(1);
  } else if (d.ats) {
    badge.className = 'badge';
    name.textContent = `Generic handling · ${d.ats}`;
  } else {
    badge.className = 'badge';
    name.textContent = 'Unknown site — nothing claimed';
  }
}

function render(d: PanelData | null): void {
  const groups = $('groups');
  if (!d) {
    $('ctx').textContent = 'no page';
    groups.innerHTML = `<p class="empty">Open a job application and this panel will list its fields.</p>`;
    $('tally').innerHTML = '';
    return;
  }
  renderBadge(d);
  $('ctx').textContent = `this form · ${d.rows.length} field${d.rows.length === 1 ? '' : 's'}`;

  const by = (g: Group) => d.rows.filter((r) => r.group === g);
  const counts = { know: by('know').length, ask: by('ask').length, remember: by('remember').length };
  $('tally').innerHTML =
    `<span class="chip k">${counts.know} filled</span>` +
    `<span class="chip a">${counts.ask} need you</span>` +
    (counts.remember ? `<span class="chip r">${counts.remember} remembered</span>` : '');

  if (!d.rows.length) {
    groups.innerHTML = `<p class="empty">No form fields found on this page.</p>`;
    $('note').textContent = '';
    return;
  }

  groups.innerHTML = GROUPS.filter((g) => by(g.id).length)
    .map(
      (g) =>
        `<section class="grp ${g.id}"><h2><span>${g.title}</span><span>${by(g.id).length}</span></h2>${by(g.id)
          .map(rowHtml)
          .join('')}</section>`,
    )
    .join('');
  $('note').textContent = counts.ask ? `${counts.ask} left for you on purpose` : 'nothing left hanging';
}

async function refresh(): Promise<void> {
  render(await rpc<PanelData>('panelFields'));
}

void initTheme();
$('refresh').addEventListener('click', () => void refresh());
// Re-read when the user switches tabs or navigates — the panel persists across both, so without this
// it would keep showing the previous page's fields.
chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === 'complete') void refresh();
});
void refresh();
