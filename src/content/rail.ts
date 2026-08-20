/**
 * The in-page rail (#140) — JobHakken docked into the application page itself, with a launcher tab on
 * the page edge.
 *
 * Why in-page rather than Chrome's `sidePanel`: a native side panel lives in browser chrome and has to
 * be found through a menu, so most people never see it. Every extension in this space — Simplify,
 * JobWizard, Careerflow — injects its own rail and puts a launcher on the page edge, because the
 * launcher is what tells the user the extension is here at all. It also drops the `sidePanel`
 * permission from our manifest entirely.
 *
 * Isolation: everything renders inside a SHADOW ROOT. The host page's CSS is arbitrary and hostile to
 * assumptions — a bare `div` would inherit whatever the ATS ships. Nothing here reads or trusts page
 * styles, and the page cannot style us.
 *
 * The page REFLOWS rather than being covered: covering an application form with a panel about that form
 * is self-defeating, and it's the difference between a rail and an overlay.
 */
export type RailApi = {
  panelFields(): Promise<PanelData>;
  fillOne(signature: string, value: string): Promise<FillResult>;
  /** Read a control's current displayed value by DOM id, independent of the panel's own field
   *  detection — see content.ts's `rawFieldValue` for why that independence matters (#164/#165). */
  rawFieldValue(id: string): string;
  learnFromPage(): Promise<number>;
  noteUse(label: string): Promise<number>;
  promote(label: string, on: boolean): Promise<void>;
  draftTwo(label: string): Promise<{ options: string[]; error?: string }>;
  siteInsight(): Promise<{ host: string; rows: { q: string; kind: string; seen: number }[] }>;
  fieldOptions(signature: string): Promise<{ options: { value: string; label: string }[]; note?: string }>;
  markFields(rows: PanelRow[], on: boolean): void;
  documents(): Promise<{
    items: { id: string; fileName: string; active: boolean }[];
    hasTemplate: boolean;
    lastDraft: string;
    coverField: 'file' | 'textarea' | null;
  }>;
  attachResume(id?: string): Promise<{ ok: boolean; name?: string }>;
  coverLetter(): Promise<{ text: string; error?: string }>;
  attachCover(text: string): Promise<{ ok: boolean; how?: string }>;
  addResume(file: File): Promise<void>;
  saveTemplate(text: string): Promise<void>;
  getProgressive(): Promise<boolean>;
  setProgressive(on: boolean): Promise<void>;
  getSiteDisabled(): Promise<boolean>;
  setSiteDisabled(on: boolean): Promise<void>;
  listRemembered(): Promise<
    Record<string, { value: string; host: string; at: number; uses: number; promoted?: boolean }>
  >;
  forgetAnswer(question: string): Promise<void>;
  editAnswer(question: string, value: string): Promise<void>;
  getFillSensitive(): Promise<boolean>;
  setFillSensitive(on: boolean): Promise<void>;
  openOptions(): void;
};

type Group = 'know' | 'ask' | 'remember' | 'sensitive';
export type PanelRow = {
  signature: string;
  /** The control's DOM id, when it has one — see content.ts's `rawFieldValue` for why a caller needs it. */
  id?: string;
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
  choices?: { count: number | null; searchable: boolean };
};
export type PanelData = { rows: PanelRow[]; ats: string | null; host: string };
type FillResult = { filled: boolean; reason?: string };

const OPEN_KEY = 'f2a_rail_open';
const FOLD_KEY = 'f2a_rail_folds';
const MARK_KEY = 'f2a_rail_marks';
const WIDTH = 320;
const ASK_AFTER = 3; // when we ASK about promoting — never when we promote
const COLLAPSE_AT = 6;

/** Escape for the one place we build HTML. The page DOM is untrusted input (CLAUDE.md). */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.wrap {
  position: fixed; top: 0; right: 0; height: 100vh; z-index: 2147483646;
  display: flex; align-items: flex-start; pointer-events: none;
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  --bg:#F4F1E8; --card:#fff; --sunk:#EDE9DC; --fg:#1E241A; --muted:#7C856F;
  --line:#DDD8C8; --line-soft:#E7E2D4; --accent:#5C7E48; --accent-deep:#4A6A38;
  --soft:#EAF0E2; --clay:#BB6535; --clay-soft:#FAEDE3; --slate:#5A6B8C; --slate-soft:#E8ECF3;
  --on-accent:#fff;
}
@media (prefers-color-scheme: dark) {
  .wrap {
    --bg:#12140F; --card:#1C2018; --sunk:#171A14; --fg:#EDEAE0; --muted:#8D9382;
    --line:#2E3428; --line-soft:#252A20; --accent:#9DBE87; --accent-deep:#7CA268;
    --soft:#1E2A19; --clay:#D0824F; --clay-soft:#2C1D12; --slate:#8FA3C4; --slate-soft:#191E28;
    --on-accent:#12140F;
  }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

/* Launcher — the whole reason this is in-page: visible on every application, no menu to find. */
.launch {
  pointer-events: auto; margin-top: 84px; width: 34px; height: 38px;
  border: 1px solid var(--accent-deep); border-right: 0; border-radius: 9px 0 0 9px;
  background: var(--accent); color: var(--on-accent);
  display: grid; place-items: center; cursor: pointer; box-shadow: -1px 2px 6px rgba(0,0,0,.16);
}
.launch:hover { filter: brightness(1.06); }
.launch:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
.launch .n {
  position: absolute; transform: translate(13px,-15px);
  background: var(--clay); color: #fff; border-radius: 99px;
  font-size: 9.5px; font-weight: 700; padding: 0 4px; min-width: 15px; text-align: center;
}

.rail {
  pointer-events: auto; width: ${WIDTH}px; height: 100vh; background: var(--bg); color: var(--fg);
  border-left: 1px solid var(--line); display: flex; flex-direction: column; overflow: hidden;
}
.rail[hidden] { display: none; }

header { padding: 10px 12px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.wm { font-weight: 800; letter-spacing: -.03em; font-size: 14px; }
.wm i { font-style: normal; color: var(--accent); }
.ctx { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.hbtns { display: flex; gap: 4px; }
.badge { display: flex; align-items: center; gap: 7px; border: 1px solid var(--line); background: var(--sunk); border-radius: 7px; padding: 5px 9px; }
.badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); flex: none; }
.badge b { font-size: 11.5px; white-space: nowrap; }
.badge .sub { font-size: 10px; color: var(--muted); font-family: ui-monospace, Menlo, monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge.named { background: var(--soft); border-color: var(--accent); }
.badge.named .dot { background: var(--accent); }
.badge.named b { color: var(--accent-deep); }
.tally { display: flex; gap: 5px; flex-wrap: wrap; }
.chip { font-size: 11px; font-weight: 650; border-radius: 99px; padding: 2px 9px; border: 1px solid; font-variant-numeric: tabular-nums; }
.chip.k { color: var(--accent-deep); background: var(--soft); border-color: var(--accent); }
.chip.a { color: var(--clay); background: var(--clay-soft); border-color: var(--clay); }
.chip.r { color: var(--slate); background: var(--slate-soft); border-color: var(--slate); }

main { flex: 1; overflow-y: auto; }
.acc { display: flex; align-items: center; gap: 7px; width: 100%; cursor: pointer; text-align: left;
  border: 0; background: none; padding: 11px 12px 5px; font-size: 10.5px; letter-spacing: .1em;
  text-transform: uppercase; font-weight: 700; font-family: inherit; }
.acc .chev { transition: transform .12s ease; font-size: 10px; }
.acc.closed .chev { transform: rotate(-90deg); }
.acc .sp { flex: 1; }
.acc .n { font-family: ui-monospace, Menlo, monospace; opacity: .7; }
.grp.know .acc { color: var(--accent-deep); }
.grp.ask .acc { color: var(--clay); }
.grp.remember .acc { color: var(--slate); }
.docs { border-bottom: 1px solid var(--line); background: var(--sunk); padding: 8px 12px; display: flex; flex-direction: column; gap: 5px; }
.doc { display: flex; align-items: center; gap: 8px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); }
.doc.on { border-color: var(--accent); background: var(--soft); }
.doc .nm { flex: 1; font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc.add { border-style: dashed; justify-content: center; color: var(--muted); font-size: 11px; cursor: pointer; }
.doc.add:hover { color: var(--fg); border-color: var(--accent); }
.cover { padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 6px; background: var(--slate-soft); border-bottom: 1px solid var(--line); }
.cover textarea { width: 100%; min-height: 90px; font: inherit; font-size: 11.5px; line-height: 1.45; padding: 7px 8px;
  border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); resize: vertical; }
.cover .rowbtns { display: flex; gap: 5px; align-items: center; }
.cover .rowbtns .sp { flex: 1; font-size: 10px; color: var(--muted); font-family: ui-monospace, Menlo, monospace; }
.opts { background: var(--sunk); border-top: 1px solid var(--line-soft); padding: 4px 0; }
.opt { display: flex; align-items: center; gap: 8px; padding: 5px 12px 5px 15px; font-size: 11.5px; cursor: pointer; }
.opt:hover { background: var(--card); }
.opt .mk { width: 11px; flex: none; color: var(--accent-deep); font-weight: 700; }
.opt.pick { background: var(--soft); }
.opt.pick .lbl { font-weight: 650; color: var(--accent-deep); }
.opt .lbl { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.taughtval { flex: 1; min-width: 0; font: inherit; font-size: 11.5px; padding: 3px 6px;
  border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--fg); }
.optnote { padding: 4px 12px 6px; font-size: 10px; font-family: ui-monospace, Menlo, monospace; color: var(--muted); }
.count { font-size: 10px; font-family: ui-monospace, Menlo, monospace; color: var(--muted); cursor: pointer; flex: none; }
.count:hover { color: var(--fg); }
.grp h2 { margin: 0; padding: 11px 12px 5px; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; display: flex; justify-content: space-between; }
.grp.know h2 { color: var(--accent-deep); } .grp.ask h2 { color: var(--clay); } .grp.remember h2 { color: var(--slate); }
.grp h2 .n { font-family: ui-monospace, Menlo, monospace; opacity: .7; }
.row { padding: 7px 12px 8px; border-top: 1px solid var(--line); border-left: 3px solid transparent; display: flex; flex-direction: column; gap: 3px; }
.grp.know .row { border-left-color: var(--accent); }
.grp.ask .row { border-left-color: var(--clay); }
.grp.remember .row { border-left-color: var(--slate); }
.row.sens { border-left-color: var(--clay) !important; border-left-style: dotted; }
.grp.sensitive .acc { color: var(--clay); }
.switches { display: flex; gap: 10px; flex-wrap: wrap; }
.switches.muted { opacity: .4; pointer-events: none; }
.switches.muted #offSw { opacity: 1; pointer-events: auto; }
.offbar { background: var(--clay-soft); border: 1px solid var(--clay); color: var(--clay);
  border-radius: 6px; padding: 6px 9px; font-size: 10.5px; font-weight: 650; }
.sw { display: inline-flex; align-items: center; gap: 5px; font-size: 9.5px; font-weight: 650;
  text-transform: none; letter-spacing: 0; color: var(--muted); }
.sw i { width: 24px; height: 13px; border-radius: 99px; background: var(--line); position: relative;
  transition: background .12s ease; flex: none; }
.sw i::after { content: ""; position: absolute; top: 1.5px; left: 1.5px; width: 10px; height: 10px;
  border-radius: 50%; background: var(--bg); transition: transform .12s ease; }
.sw { cursor: pointer; }
.sw.on i { background: var(--accent); }
.sw.danger.on i { background: var(--clay); }
.sw.on i::after { transform: translateX(11px); }
.row.done { background: var(--soft); }
.row.promote { background: var(--slate-soft); }
.k { font-size: 11.5px; color: var(--muted); line-height: 1.35; }
.v { display: flex; align-items: center; gap: 6px; }
.val { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.val.none { color: var(--muted); font-style: italic; font-family: inherit; }
.why { font-size: 10.5px; color: var(--muted); font-style: italic; }
.src { font-size: 10.5px; color: var(--muted); font-family: ui-monospace, Menlo, monospace; }
.src.ask-promote { color: var(--slate); font-weight: 650; font-family: inherit; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.type { font-family: ui-monospace, Menlo, monospace; font-size: 9.5px; color: var(--muted); border: 1px solid var(--line); border-radius: 3px; padding: 0 4px; flex: none; }
.warn { color: var(--clay); font-weight: 700; font-size: 10px; flex: none; }
button { font: inherit; font-size: 11px; font-weight: 650; border: 1px solid var(--line); background: var(--sunk); color: var(--fg); border-radius: 5px; padding: 2px 8px; cursor: pointer; flex: none; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button:disabled { opacity: .55; cursor: default; }
button.fill, button.use { border-color: var(--slate); color: var(--slate); }
button.draft { border-color: var(--clay); color: var(--clay); }
button.yes { border-color: var(--accent); color: var(--accent-deep); background: var(--soft); }
.more { padding: 7px 12px; font-size: 11px; color: var(--muted); font-style: italic; border-top: 1px solid var(--line); cursor: pointer; }
.more:hover { color: var(--fg); }
.variants { padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 7px; background: var(--slate-soft); border-top: 1px solid var(--line); }
.variant { border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; background: var(--bg); display: flex; flex-direction: column; gap: 5px; }
.vh { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.vt { font-size: 9.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.variant p { margin: 0; font-size: 11.5px; line-height: 1.45; }
.drafting { padding: 10px 12px; font-size: 11px; color: var(--muted); background: var(--slate-soft); border-top: 1px solid var(--line); }
table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
th, td { text-align: left; padding: 6px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 9.5px; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); background: var(--sunk); }
td.n { font-family: ui-monospace, Menlo, monospace; text-align: right; width: 3em; }
.empty { padding: 28px 16px; color: var(--muted); text-align: center; }
.empty b { display: block; color: var(--fg); margin-bottom: 4px; }
footer { border-top: 1px solid var(--line); background: var(--sunk); padding: 9px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.note { font-size: 10.5px; color: var(--muted); display: flex; align-items: center; gap: 5px; }
.note::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex: none; }
.cta { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
`;

const LOUPE = `<svg width="18" height="18" viewBox="0 0 64 64" fill="none" aria-hidden="true">
<path d="M40 10 L40 29" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
<circle cx="33" cy="40" r="12" stroke="currentColor" stroke-width="6"/>
<line x1="42" y1="49" x2="54" y2="59" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg>`;

const TESTED: Record<string, string> = {
  greenhouse: 'react-select · file upload',
  lever: 'native selects · file upload',
  ashby: 'react widgets · file upload',
  workable: 'native selects',
  recruitee: 'native selects',
  successfactors: 'native selects',
  bamboohr: 'iframed form',
};
const TITLES: Record<Group, string> = {
  know: 'Filled — high confidence',
  ask: "Need you — we won't guess",
  remember: 'Remembered from you',
  sensitive: 'Sensitive — your call',
};

/**
 * True when this content script has been severed from the extension — which happens the moment the
 * extension is reloaded while a page stays open. `chrome.storage` then reads as undefined, and any call
 * throws "Cannot read properties of undefined (reading 'local')" at whatever the user just clicked.
 * Better to say so and offer the fix than to surface a TypeError.
 */
function orphaned(): boolean {
  try {
    return !chrome?.runtime?.id || !chrome?.storage?.local;
  } catch {
    return true;
  }
}

export function mountRail(api: RailApi): void {
  if (document.getElementById('jh-rail-host')) return; // idempotent: SPA re-renders must not stack rails

  const host = document.createElement('div');
  host.id = 'jh-rail-host';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  root.append(style);

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <button class="launch" id="launch" title="JobHakken" aria-label="Open JobHakken">${LOUPE}<span class="n" id="lcount" hidden></span></button>
    <section class="rail" id="rail" hidden aria-label="JobHakken">
      <header>
        <div class="top">
          <span class="wm">Job<i>Hakken</i></span>
          <span class="ctx" id="ctx"></span>
          <span class="hbtns">
            <button id="taught" title="What I've learned" aria-label="What I've learned">🧠</button>
            <button id="gear" title="Settings" aria-label="Settings">⚙</button>
            <button id="close" title="Close" aria-label="Close">✕</button>
          </span>
        </div>
        <div class="badge" id="badge"><span class="dot"></span><b id="bname">Reading page…</b><span class="sub" id="bsub"></span></div>
        <div class="tally" id="tally"></div>
        <div class="switches">
          <span class="sw" id="progSw" title="Fill each field as you scroll to it"><i></i>fill as I scroll</span>
          <span class="sw danger" id="offSw" title="Silence JobHakken on this site"><i></i>off here</span>
        </div>
        <div class="offbar" id="offbar" hidden>Off on this site — nothing will be filled. Turn "off here" back on to resume.</div>
      </header>
      <main id="body"></main>
      <footer>
        <span class="note" id="note"></span>
        <span class="hbtns">
          <button id="marks" title="Outline these fields on the page">▣</button>
        </span>
        <button class="cta" id="fillAll" hidden>Fill</button>
      </footer>
    </section>`;
  root.append(wrap);
  (document.body ?? document.documentElement).append(host);

  const $ = <T extends HTMLElement>(id: string) => root.getElementById(id) as T;
  let rows: PanelRow[] = [];
  const drafted = new Map<string, string[]>();
  const expanded = new Set<string>();
  let insightMode = false;
  let folds: Partial<Record<Group | 'docs' | 'insight', boolean>> = {};
  let marksOn = false;
  let sensitiveOn = true;
  let progOn = false;
  let siteOff = false;
  let taughtMode = false;

  /** Push the page over instead of covering it — a panel about a form must not hide the form. */
  function reflow(open: boolean): void {
    const el = document.documentElement;
    el.style.transition = 'margin-right .15s ease';
    el.style.marginRight = open ? `${WIDTH}px` : '';
  }

  async function setOpen(open: boolean, persist = true): Promise<void> {
    $('rail').hidden = !open;
    $<HTMLElement>('launch').style.display = open ? 'none' : '';
    reflow(open);
    if (persist) await chrome.storage.local.set({ [OPEN_KEY]: open }).catch(() => {});
    if (open) await refresh();
  }

  const when = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  function isOpen(r: PanelRow): boolean {
    if (r.consequential) return false; // never draft an answer to something legally consequential
    return r.kind === 'textarea' || (r.kind === 'text' && r.label.length > 45);
  }

  function rowHtml(r: PanelRow): string {
    const has = !!r.value;
    const shown = r.value || r.current;
    const canFill = has && r.current.trim() !== r.value.trim();
    const sig = esc(r.signature);
    const asking = !!r.memo && !r.memo.promoted && r.memo.uses >= ASK_AFTER;

    let foot = '';
    if (asking && r.memo) {
      foot = `<span class="src ask-promote">you've used this ${r.memo.uses}× — always fill it?
        <button class="yes" data-act="promote" data-sig="${sig}">Always</button>
        <button data-act="dismiss" data-sig="${sig}">Keep asking</button></span>`;
    } else if (r.memo?.promoted) {
      foot = `<span class="src">you wrote this · always filled</span>`;
    } else if (r.memo) {
      foot = `<span class="src">you wrote this · ${esc(when(r.memo.at))} · ${esc(r.memo.host.replace(/^www\./, '').split('.')[0])}</span>`;
    } else if (r.why) {
      foot = `<span class="why">${esc(r.why)}</span>`;
    }
    if (r.asked && !r.memo) foot += `<span class="src">asked on ${r.asked.hits} of your last ${r.asked.of}</span>`;

    return `<div class="row${asking ? ' promote' : ''}${r.group === 'sensitive' ? ' sens' : ''}" data-sig="${sig}">
      <span class="k">${esc(r.label || '(unlabelled field)')}</span>
      <span class="v">
        <span class="val${shown ? '' : ' none'}">${shown ? esc(shown) : 'nothing to put here'}</span>
        ${r.consequential ? '<span class="warn" title="A wrong answer here costs you something">!</span>' : ''}
        <span class="type">${esc(r.kind)}</span>
        ${canFill ? `<button class="fill" data-act="fill" data-sig="${sig}">Fill</button>` : ''}
        ${has && !canFill ? `<button data-act="copy" data-sig="${sig}">Copy</button>` : ''}
        ${!has && r.addable ? `<button data-act="add" data-sig="${sig}">Add</button>` : ''}
        ${!has && !r.addable && isOpen(r) ? `<button class="draft" data-act="draft" data-sig="${sig}">✍ Draft 2</button>` : ''}
        ${r.choices ? `<span class="count" data-act="opts" data-sig="${sig}">${r.choices.count ?? (r.choices.searchable ? 'search' : 'options')} ${r.choices.count ? 'options' : ''} ▾</span>` : ''}
      </span>
      ${foot}
    </div>`;
  }

  function render(d: PanelData): void {
    rows = d.rows;
    const badge = $('badge');
    const tested = d.ats ? TESTED[d.ats] : undefined;
    if (d.ats && tested) {
      badge.className = 'badge named';
      $('bname').textContent = d.ats.charAt(0).toUpperCase() + d.ats.slice(1);
      $('bsub').textContent = tested;
    } else {
      badge.className = 'badge';
      $('bname').textContent = d.ats ? 'Generic handling' : 'Unknown site';
      $('bsub').textContent = d.ats ? `${d.ats} · not yet verified` : 'nothing claimed';
    }
    $('ctx').textContent = `${d.rows.length} field${d.rows.length === 1 ? '' : 's'}`;

    // Sensitive rows sit inside Filled rather than in a section of their own: when the switch is on they
    // ARE filled, and a separate section for six rows split the one list people actually scan. They keep
    // their own marker and the switch that governs them.
    const by = (g: Group) =>
      g === 'know'
        ? [...d.rows.filter((r) => r.group === 'know'), ...d.rows.filter((r) => r.group === 'sensitive')]
        : d.rows.filter((r) => r.group === g);
    const n = { know: by('know').length, ask: by('ask').length, remember: by('remember').length };
    $('tally').innerHTML =
      (n.know ? `<span class="chip k">${n.know} filled</span>` : '') +
      (n.ask ? `<span class="chip a">${n.ask} need you</span>` : '') +
      (n.remember ? `<span class="chip r">${n.remember} remembered</span>` : '');

    const pending = d.rows.filter(
      (r) => r.value && r.current.trim() !== r.value.trim() && (sensitiveOn || r.group !== 'sensitive'),
    );
    const cta = $<HTMLButtonElement>('fillAll');
    cta.hidden = !pending.length;
    cta.textContent = `Fill ${pending.length}`;
    $('note').textContent = n.ask ? `${n.ask} left for you` : 'learning from this form';

    // 'off here' overrides everything, so grey the rest out rather than showing two contradictory "on"
    // switches — which is exactly how 'fill as I scroll' looked broken when the site was simply off.
    $('progSw').className = `sw${progOn ? ' on' : ''}`;
    $('offSw').className = `sw danger${siteOff ? ' on' : ''}`;
    $('offbar').hidden = !siteOff;
    (root.querySelector('.switches') as HTMLElement).className = `switches${siteOff ? ' muted' : ''}`;
    if (!d.rows.length) {
      $('body').innerHTML = `<p class="empty"><b>No form fields here</b>Open an application and this fills in.</p>`;
      return;
    }
    // Documents is a SECTION, not a hidden view: choosing a résumé and writing a letter are part of
    // filling the application, not settings you go looking for.
    const docsFolded = folds.docs ?? false;
    const docsSection =
      `<section class="grp docs-grp">` +
      `<button class="acc${docsFolded ? ' closed' : ''}" data-fold="docs">` +
      `<span class="chev">▾</span><span class="sp">Résumé &amp; cover letter</span>` +
      `<span class="n">${docState ? docState.items.length : '·'}</span></button>` +
      (docsFolded ? '' : docsHtml()) +
      `</section>`;

    $('body').innerHTML =
      (['know', 'ask', 'remember'] as Group[])
        .filter((g) => by(g).length)
        .map((g) => {
          const list = by(g);
          // A long Filled list is reference material — keep "need you" and "remembered" above the fold.
          const cut = g === 'know' && list.length > COLLAPSE_AT && !expanded.has(g);
          const shown = cut ? list.slice(0, COLLAPSE_AT) : list;
          // Filled and Remembered are settled information; what needs the user stays open and on top.
          const folded = folds[g] ?? (g === 'know' || g === 'remember');
          return (
            `<section class="grp ${g}">` +
            `<button class="acc${folded ? ' closed' : ''}" data-fold="${g}">` +
            `<span class="chev">▾</span><span class="sp">${TITLES[g]}</span>` +
            (g === 'know' && d.rows.some((r) => r.group === 'sensitive')
              ? `<span class="sw${sensitiveOn ? ' on' : ''}" data-act="sw" title="Fill these automatically">` +
                `<i></i>${sensitiveOn ? 'auto' : 'manual'}</span>`
              : '') +
            `<span class="n">${list.length}</span></button>` +
            (folded
              ? ''
              : shown.map(rowHtml).join('') +
                (cut ? `<div class="more" data-more="${g}">+ ${list.length - COLLAPSE_AT} more filled</div>` : '')) +
            `</section>`
          );
        })
        .join('') + docsSection;
    if (marksOn) api.markFields(d.rows, true);
  }

  /**
   * Documents for this application. Uploading lives HERE rather than in Settings because this is the
   * moment the decision is being made — which résumé for this job — and sending someone to a settings
   * page mid-application is how a tool loses them.
   */
  let docState: Awaited<ReturnType<RailApi['documents']>> | null = null;

  function docsHtml(): string {
    const d = docState;
    if (!d) return `<div class="optnote">reading documents…</div>`;
    return (
      `<div class="docs">` +
      (d.items.length
        ? d.items
            .map(
              (i) =>
                `<div class="doc${i.active ? ' on' : ''}"><span class="nm">${esc(i.fileName)}</span>` +
                (i.active
                  ? `<button data-act="attach" data-id="${esc(i.id)}">Attach</button>`
                  : `<button data-act="use" data-id="${esc(i.id)}">Use</button>`) +
                `</div>`,
            )
            .join('')
        : `<div class="optnote">No résumé stored yet.</div>`) +
      `<div class="doc add" data-act="upload">＋ Upload a résumé</div></div>` +
      `<div class="cover">` +
      `<div class="rowbtns"><span class="sp">${
        d.coverField
          ? `cover letter · ${d.coverField === 'file' ? 'upload' : 'text box'} on this form`
          : 'no cover letter field here'
      }</span>` +
      `<button class="draft" data-act="writecover">✍ ${d.lastDraft ? 'Rewrite' : 'Write'}</button></div>` +
      `<textarea id="coverText" placeholder="${
        d.hasTemplate ? 'Uses your template — press Write' : 'No template saved; it will write from your profile'
      }">${esc(d.lastDraft)}</textarea>` +
      `<div class="rowbtns"><span class="sp">editable before it goes anywhere</span>` +
      `<button data-act="savetpl">Save as template</button>` +
      `<button class="use" data-act="attachcover">Attach</button></div></div>`
    );
  }

  /**
   * What you've taught me — the answers we learned, with an undo.
   *
   * A system that learns WILL learn something wrong, and without a way to see and correct it people
   * stop trusting the whole mechanism. Wiping everything is not an undo.
   */
  async function showTaught(): Promise<void> {
    const all = await api.listRemembered();
    const rows = Object.entries(all).sort((a, b) => (b[1].uses ?? 0) - (a[1].uses ?? 0));
    $('tally').innerHTML = rows.length ? `<span class="chip r">${rows.length} learned</span>` : '';
    $<HTMLButtonElement>('fillAll').hidden = true;
    $('note').textContent = 'yours, on this device';
    const site = await api.siteInsight().catch(() => null);
    const siteTable =
      site && site.rows.length
        ? `<section class="grp"><button class="acc closed" data-fold="insight">` +
          `<span class="chev">▾</span><span class="sp">Questions ${esc(site.host.replace(/^www\./, ''))} asks</span>` +
          `<span class="n">${site.rows.length}</span></button>` +
          (folds.insight === false
            ? `<table><thead><tr><th>Question</th><th>Type</th><th class="n">Seen</th></tr></thead><tbody>` +
              site.rows
                .map(
                  (r) =>
                    `<tr><td>${esc(r.q)}</td><td><span class="type">${esc(r.kind)}</span></td><td class="n">${r.seen}</td></tr>`,
                )
                .join('') +
              `</tbody></table><div class="optnote">structure only · no answers stored here</div>`
            : '') +
          `</section>`
        : '';
    $('body').innerHTML =
      (rows.length
        ? rows
            .map(
              ([q, v]) =>
                `<div class="row" data-q="${esc(q)}" style="border-left-color:var(--slate)">
                <span class="k">${esc(q)}</span>
                <span class="v"><input class="taughtval" data-q="${esc(q)}" value="${esc(v.value)}" />
                  <button data-act="save-taught" data-q="${esc(q)}">Save</button>
                  <button data-act="forget" data-q="${esc(q)}">Forget</button></span>
                <span class="src">used ${v.uses ?? 0}× · ${esc(v.host.replace(/^www\./, '').split('.')[0])}${v.promoted ? ' · always filled' : ''}</span>
              </div>`,
            )
            .join('')
        : `<p class="empty"><b>Nothing learned yet</b>Answer a question we left to you and it will appear here.</p>`) +
      siteTable;
  }

  async function refresh(): Promise<void> {
    if (taughtMode) {
      await showTaught();
      return;
    }
    const [data, docs] = await Promise.all([api.panelFields(), api.documents().catch(() => null)]);
    docState = docs;
    render(data);
  }

  /** Badge the launcher with what needs the user, so a collapsed rail still communicates. */
  async function updateLauncher(): Promise<void> {
    try {
      const d = await api.panelFields();
      const need = d.rows.filter((r) => r.group === 'ask').length;
      const c = $('lcount');
      c.hidden = need === 0;
      c.textContent = String(need);
    } catch {
      /* page not ready — the launcher just shows unbadged */
    }
  }

  function markRow(sig: string, res: FillResult): void {
    const el = root.querySelector<HTMLElement>(`.row[data-sig="${CSS_escape(sig)}"]`);
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
    if (btn) {
      btn.textContent = 'Copy';
      btn.dataset.act = 'copy';
    }
    const msg =
      res.reason === 'widget'
        ? "this control won't take a pasted value — copy it, we've scrolled to the field"
        : res.reason === 'gone'
          ? 'the page changed — reopen the rail'
          : 'could not fill this one';
    const why = el.querySelector('.why');
    if (why) why.textContent = msg;
    else el.insertAdjacentHTML('beforeend', `<span class="why">${esc(msg)}</span>`);
  }

  // CSS.escape isn't guaranteed in every page world; signatures are ours, so a conservative quote is fine.
  function CSS_escape(s: string): string {
    return s.replace(/["\\]/g, '\\$&');
  }

  /**
   * Turn page marking on after a fill, without being asked. Someone who has just pressed Fill wants to
   * see WHAT was filled — leaving that behind a toggle means the work is invisible at the moment it
   * matters most. It stays on afterwards (and remains switchable from the header).
   */
  function markAfterFill(): void {
    if (marksOn) return;
    marksOn = true;
    const btn = root.getElementById('marks');
    if (btn) btn.style.background = 'var(--soft)';
    void chrome.storage.local.set({ [MARK_KEY]: true }).catch(() => {});
  }

  async function fillRow(sig: string): Promise<void> {
    const row = rows.find((r) => r.signature === sig);
    if (!row) return;
    const res = await api.fillOne(sig, row.value);
    markRow(sig, res);
    if (res.filled) markAfterFill();
    if (res.filled && row.memo) {
      await api.noteUse(row.label); // the signal the promotion prompt reads
      await refresh();
    }
  }

  /**
   * List what a field accepts, ours marked. Picking here sets the value through the component, so the
   * page's own menu never opens — which is also why this cannot leave a dropdown stuck half-driven.
   */
  async function showOptions(sig: string): Promise<void> {
    const el = root.querySelector<HTMLElement>(`.row[data-sig="${CSS_escape(sig)}"]`);
    const row = rows.find((r) => r.signature === sig);
    if (!el || !row) return;
    const next = el.nextElementSibling;
    if (next?.classList.contains('opts')) return next.remove(); // toggle closed
    el.insertAdjacentHTML('afterend', '<div class="opts"><div class="optnote">reading options…</div></div>');
    const box = el.nextElementSibling as HTMLElement | null;
    const { options, note } = await api.fieldOptions(sig);
    if (!box) return;
    if (!options.length) {
      box.innerHTML = `<div class="optnote">${esc(note ?? 'no fixed options — type into the field')}</div>`;
      return;
    }
    const mine = row.value.trim().toLowerCase();
    box.innerHTML =
      options
        .slice(0, 40)
        .map((o) => {
          const picked = !!mine && o.label.trim().toLowerCase() === mine;
          return `<div class="opt${picked ? ' pick' : ''}" data-act="pick" data-sig="${esc(sig)}" data-v="${esc(o.label)}">
            <span class="mk">${picked ? '✓' : ''}</span><span class="lbl">${esc(o.label)}</span></div>`;
        })
        .join('') +
      (options.length > 40 ? `<div class="optnote">showing 40 of ${options.length}</div>` : '') +
      // If our value isn't among the options, say so plainly instead of offering it anyway (#153).
      (mine && !options.some((o) => o.label.trim().toLowerCase() === mine)
        ? `<div class="optnote">your value "${esc(row.value)}" isn't one of these — pick one</div>`
        : '');
  }

  async function draftRow(sig: string): Promise<void> {
    const row = rows.find((r) => r.signature === sig);
    const el = root.querySelector<HTMLElement>(`.row[data-sig="${CSS_escape(sig)}"]`);
    if (!row || !el) return;
    // Clear any previous draft block for this row before requesting a new one.
    const prev = el.nextElementSibling;
    if (prev && (prev.classList.contains('variants') || prev.classList.contains('drafting'))) prev.remove();
    el.insertAdjacentHTML('afterend', '<div class="drafting">drafting two options — one call…</div>');
    const box = el.nextElementSibling as HTMLElement | null;
    const res = await api.draftTwo(row.label);
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
          `<button class="use" data-act="usedraft" data-sig="${esc(sig)}" data-i="${i}">Fill</button></div><p>${esc(o)}</p></div>`,
      )
      .join('');
    drafted.set(sig, res.options);
  }

  wrap.addEventListener('click', (e) => {
    if (orphaned()) {
      $('note').textContent = 'Extension was reloaded — refresh this page to reconnect';
      return;
    }
    const t = e.target as HTMLElement;
    const more = t.closest<HTMLElement>('[data-more]');
    if (more) {
      expanded.add(more.dataset.more ?? '');
      void refresh();
      return;
    }
    const prog = t.closest<HTMLElement>('#progSw');
    if (prog) {
      progOn = !progOn;
      void api.setProgressive(progOn).then(() => refresh());
      return;
    }
    const off = t.closest<HTMLElement>('#offSw');
    if (off) {
      siteOff = !siteOff;
      void api.setSiteDisabled(siteOff).then(() => refresh());
      return;
    }
    const sw = t.closest<HTMLElement>('[data-act="sw"]');
    if (sw) {
      sensitiveOn = !sensitiveOn;
      void api.setFillSensitive(sensitiveOn).then(() => refresh());
      return;
    }
    const fold = t.closest<HTMLElement>('[data-fold]');
    if (fold) {
      const g = fold.dataset.fold as Group | 'docs' | 'insight';
      // Filled and Remembered are settled; what needs you, sensitive choices and documents open by default.
      folds[g] = !(folds[g] ?? (g === 'know' || g === 'remember' || g === 'insight'));
      void chrome.storage.local.set({ [FOLD_KEY]: folds }).catch(() => {});
      void refresh();
      return;
    }
    const pick = t.closest<HTMLElement>('[data-act="pick"]');
    if (pick) {
      const sig = pick.dataset.sig ?? '';
      const v = pick.dataset.v ?? '';
      if (v)
        void api.fillOne(sig, v).then((r) => {
          markRow(sig, r);
          if (r.filled) markAfterFill();
        });
      return;
    }
    const optToggle = t.closest<HTMLElement>('[data-act="opts"]');
    if (optToggle) {
      void showOptions(optToggle.dataset.sig ?? '');
      return;
    }
    const btn = t.closest<HTMLButtonElement>('button');
    if (!btn) return;
    if (btn.id === 'marks') {
      marksOn = !marksOn;
      btn.style.background = marksOn ? 'var(--soft)' : '';
      api.markFields(rows, marksOn);
      void chrome.storage.local.set({ [MARK_KEY]: marksOn }).catch(() => {});
      return;
    }
    if (btn.id === 'launch') return void setOpen(true);
    if (btn.id === 'close') return void setOpen(false);
    if (btn.id === 'gear') return api.openOptions();
    if (btn.id === 'taught') {
      taughtMode = !taughtMode;
      insightMode = false;
      btn.style.background = taughtMode ? 'var(--slate-soft)' : '';
      return void refresh();
    }
    if (btn.id === 'docs') {
      // The section is always present now; this just takes you to it.
      root.querySelector('.docs-grp')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (btn.id === 'insight') {
      insightMode = !insightMode;
      btn.textContent = insightMode ? '◑' : '◔';
      return void refresh();
    }
    if (btn.id === 'fillAll') {
      void (async () => {
        btn.disabled = true;
        const before = btn.textContent;
        btn.textContent = 'Filling…';
        let current = rows;
        // Answering one question can reveal another that didn't exist in the DOM a moment ago —
        // verified live: Greenhouse's "Race" only renders after "Are you Hispanic/Latino?" is answered
        // (#162). A single fixed pass over the panel's original snapshot never sees it. Re-check for
        // newly-fillable rows after each pass instead, bounded so a page that keeps generating "new"
        // signatures (a bug elsewhere, or genuinely unbounded content) can't loop forever.
        //
        // Re-checks every row each pass, not just ones we haven't attempted (#164). Some forms model one
        // logical question as two linked controls, and answering the second can rewrite the first:
        // verified live on Greenhouse, whose ethnicity question is a hispanic yes/no PLUS a race dropdown
        // that only exists while the answer is "No". Declining the race is the same statement as
        // declining the ethnicity, so the form collapses the pair — hispanic flips to Decline and the
        // race control is removed. That's correct on the form's part, and no page state holds
        // hispanic="No" alongside race="Decline", so retrying both every pass just oscillates and lands
        // on whichever state the pass count's parity stops at. Instead, "poison" a signature once its
        // fill is seen to rewrite a field we'd already landed: it's never retried, the run converges, and
        // the collapsed answer stands (a declined pair IS a complete, faithful answer — restoring the
        // first field would only re-reveal a required control we've stopped trying to fill).
        const poisoned = new Set<string>();
        // What each successful fill actually PUT on the page, by DOM id — not the profile's literal
        // string. A value resolved through a fuzzy tier (the decline-interchangeable mapping: profile
        // "Prefer not to say" → this form's "Decline To Self Identify") never equals its own `value` as
        // text, so comparing against `value` would never see those fields as landed — exactly the fields
        // most likely to be half of a linked pair. Comparing against what landed avoids that entirely.
        //
        // Read back through `rawFieldValue` (by DOM id) rather than a row's own `current`, so this stays
        // correct even for a control that has dropped out of field detection.
        const confirmed = new Map<string, { id: string; value: string }>();
        let lastFilled: string | null = null;
        /**
         * Attribute any damage the previous fill caused, then stop tracking what it broke.
         *
         * Dropping the broken entries is essential, not tidiness: a clobbered value we keep watching
         * reports "regressed" on every later check, so the next innocent field to be filled — and then
         * every one after it — would be blamed and skipped.
         */
        const noteRegressions = (): void => {
          const broken = [...confirmed.entries()]
            .filter(([, c]) => api.rawFieldValue(c.id).trim() !== c.value.trim())
            .map(([sig]) => sig);
          if (!broken.length) return;
          for (const sig of broken) confirmed.delete(sig);
          if (lastFilled) poisoned.add(lastFilled);
        };
        for (let pass = 0; pass < 5; pass++) {
          const toFill = current.filter(
            (x) =>
              x.value &&
              x.current.trim() !== x.value.trim() &&
              (sensitiveOn || x.group !== 'sensitive') &&
              !poisoned.has(x.signature),
          );
          if (!toFill.length) break;
          // Sequential: these drive real widgets, and racing them is what users saw as the page jumping.
          for (const r of toFill) {
            // Check for a cascade from the PREVIOUS fill here, rather than sleeping after each one to
            // wait for it. A form's reaction is its own timing, not ours (measured ~400ms out on
            // Greenhouse), but driving the next widget already takes longer than that, so by now it has
            // landed — and this costs no added wall-clock, where polling every field cost ~30s a run.
            noteRegressions();
            if (poisoned.has(r.signature)) continue;
            const fillRes = await api.fillOne(r.signature, r.value);
            markRow(r.signature, fillRes);
            lastFilled = r.signature;
            if (fillRes.filled && r.id) confirmed.set(r.signature, { id: r.id, value: api.rawFieldValue(r.id) });
            current = (await api.panelFields()).rows;
          }
          noteRegressions(); // the pass's last fill has no successor to notice its cascade
        }
        markAfterFill(); // show what just happened on the form itself
        btn.textContent = before;
        btn.disabled = false;
        await refresh();
      })();
      return;
    }
    const sig = btn.dataset.sig ?? '';
    const row = rows.find((r) => r.signature === sig);
    switch (btn.dataset.act) {
      case 'fill':
        void fillRow(sig);
        break;
      case 'draft':
        void draftRow(sig);
        break;
      case 'usedraft': {
        const text = drafted.get(sig)?.[Number(btn.dataset.i ?? 0)];
        if (text)
          void api.fillOne(sig, text).then(async (r) => {
            markRow(sig, r);
            if (r.filled) {
              await api.learnFromPage(); // what you accepted becomes yours
              await refresh();
            }
          });
        break;
      }
      case 'promote':
        if (row) void api.promote(row.label, true).then(() => refresh());
        break;
      case 'dismiss':
        btn.closest('.row')?.classList.remove('promote');
        btn.closest('.src')?.remove();
        break;
      case 'add':
        api.openOptions();
        break;
      case 'forget':
        void api.forgetAnswer(btn.dataset.q ?? '').then(() => refresh());
        break;
      case 'save-taught': {
        const q = btn.dataset.q ?? '';
        const inp = root.querySelector<HTMLInputElement>(`.taughtval[data-q="${CSS_escape(q)}"]`);
        if (inp?.value.trim())
          void api.editAnswer(q, inp.value).then(() => {
            btn.textContent = 'Saved';
          });
        break;
      }
      case 'use':
        void api.attachResume(btn.dataset.id).then(() => refresh());
        break;
      case 'attach':
        void api.attachResume(btn.dataset.id).then((r) => {
          btn.textContent = r.ok ? 'Attached' : 'No résumé field';
          btn.disabled = r.ok;
        });
        break;
      case 'upload': {
        // A file input inside the shadow root: the picker is a user gesture we already have.
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.pdf,.doc,.docx,.txt,.rtf';
        inp.addEventListener('change', () => {
          const f = inp.files?.[0];
          if (f) void api.addResume(f).then(() => refresh());
        });
        inp.click();
        break;
      }
      case 'writecover': {
        const ta = root.getElementById('coverText') as HTMLTextAreaElement | null;
        if (ta) ta.placeholder = 'writing…';
        btn.disabled = true;
        void api.coverLetter().then((r) => {
          btn.disabled = false;
          if (!ta) return;
          if (r.text) ta.value = r.text;
          else ta.placeholder = r.error ?? 'nothing came back';
        });
        break;
      }
      case 'savetpl': {
        const ta = root.getElementById('coverText') as HTMLTextAreaElement | null;
        if (ta?.value.trim()) {
          void api.saveTemplate(ta.value);
          btn.textContent = 'Saved';
        }
        break;
      }
      case 'attachcover': {
        const ta = root.getElementById('coverText') as HTMLTextAreaElement | null;
        if (ta?.value.trim())
          void api.attachCover(ta.value).then((r) => {
            btn.textContent = r.ok ? (r.how ?? 'Attached') : 'No cover field';
          });
        break;
      }
      case 'pick': {
        const v = btn.dataset.v ?? '';
        if (v) void api.fillOne(sig, v).then((r) => markRow(sig, r));
        break;
      }
      case 'copy':
        if (row?.value) void navigator.clipboard.writeText(row.value).catch(() => {});
        break;
    }
  });

  // Learn what the user typed whenever they come back to the rail, then re-read.
  wrap.addEventListener('mouseenter', () => {
    if (!$('rail').hidden) void api.learnFromPage().then(() => refresh());
  });

  void (async () => {
    const got = (await chrome.storage.local.get([OPEN_KEY, FOLD_KEY, MARK_KEY]).catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const open = !!got[OPEN_KEY];
    folds = (got[FOLD_KEY] as Partial<Record<Group | 'docs' | 'insight', boolean>>) ?? {};
    marksOn = !!got[MARK_KEY];
    sensitiveOn = await api.getFillSensitive();
    progOn = await api.getProgressive();
    siteOff = await api.getSiteDisabled();
    await setOpen(open, false);
    if (!open) await updateLauncher();
  })();
}

/** Remove the rail and undo the page reflow — used when a page turns out not to be an application. */
export function unmountRail(): void {
  document.getElementById('jh-rail-host')?.remove();
  document.documentElement.style.marginRight = '';
}
