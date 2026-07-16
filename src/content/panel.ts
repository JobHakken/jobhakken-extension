/**
 * The docked on-page panel (v2, autofill-first). Rendered in a shadow root so the host
 * page's CSS can't reach it. Presentational — all logic lives in content.ts and is passed
 * as callbacks. Autofill is the hero (with the résumé merged in: default vs ATS-tailored);
 * the AI signals collapse behind "Job insights"; when the desktop app isn't connected the
 * panel shows only Autofill. Collapses to a bubble.
 */
export type PanelState = {
  mode: 'connected' | 'standalone' | 'none';
  fields: number;
  job?: { title?: string; company?: string; url?: string };
  testMode?: boolean;
  captureMode?: boolean;
  captureSite?: { show: boolean; optedIn: boolean };
};

export type Insights = { ats?: number | null; visa?: string; keywords?: { have: string[]; gap: string[] }; error?: string };

export type PanelDeps = {
  version?: string;
  getState: () => PanelState;
  onAutofill: (mode: 'default' | 'ats') => Promise<{ filled: number; review: number; total: number } | null>;
  onAnalyze: () => Promise<Insights | null>;
  onDraft: () => Promise<{ ok: boolean; error?: string } | null>;
  onSave: () => Promise<{ ok: boolean; error?: string } | null>;
  onCapture: () => Promise<{ total: number; resolved: number; unresolved: number; unresolvedLabels: string[] } | null>;
  onToggleCaptureSite?: (on: boolean) => void;
  onOpenOptions: () => void;
};

const STYLE = `
:host{ all: initial; }
*{ box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
.wrap{ position:fixed; top:76px; right:16px; width:336px; z-index:2147483647; }
.card{ background:#fff; color:#171a21; border:1px solid #e3e6ec; border-radius:15px; box-shadow:0 18px 50px -16px rgba(20,24,40,.4),0 2px 8px -2px rgba(20,24,40,.14); overflow:hidden; }
@media (prefers-color-scheme:dark){ .card{ background:#171a21; color:#e6e8ec; border-color:#2a2f3a; } .sub,.count,.jobline,.mini button,.ins summary{color:#9aa1ac;} .fill.a{background:#171a21;} .fill.a .big{color:#7d80f0;} .row,.ins,.mini button,.fill.a,.rz{border-color:#2a2f3a!important;} .foot{background:#1d212a;} .ins .body,.mini button{background:#171a21;} .surf{background:#1d212a!important;} }
.hd{ display:flex; align-items:center; gap:8px; padding:11px 13px; border-bottom:1px solid #e3e6ec; }
.mk{ width:23px;height:23px;border-radius:7px;background:linear-gradient(135deg,#5457d6,#0f9d6b);display:grid;place-items:center;color:#fff;font-size:12px; }
.nm{ font-weight:700; font-size:13.5px; letter-spacing:-.01em; }
.ver{ font-size:10px; color:#9aa1ac; font-weight:600; }
.conn{ margin-left:auto; display:inline-flex; align-items:center; gap:6px; font-size:10.5px; color:#6b7280; }
.conn .d{ width:7px;height:7px;border-radius:50%; }
.conn.connected .d{ background:#0f9d6b; box-shadow:0 0 0 3px #0f9d6b22; }
.conn.standalone .d, .conn.none .d{ background:#9aa1ac; }
.gear{ width:26px;height:26px;border-radius:7px;border:none;background:transparent;color:#9aa1ac;font-size:15px;cursor:pointer;display:grid;place-items:center;line-height:1; }
.gear:hover{ background:#f0f1f4; color:#171a21; }
.x{ width:24px;height:24px;border:none;background:transparent;color:#9aa1ac;font-size:15px;cursor:pointer;line-height:1; }
.testbar{ display:flex; align-items:center; gap:7px; background:#c2740c; color:#fff; font-size:11px; font-weight:700; padding:6px 13px; }
.testbar .d{ width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px #ffffff44; }
.bd{ padding:13px; display:flex; flex-direction:column; gap:11px; }
.jobline{ display:flex; align-items:center; gap:7px; font-size:12px; color:#6b7280; min-width:0; }
.jobline b{ color:#171a21; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
@media (prefers-color-scheme:dark){ .jobline b{ color:#e6e8ec; } .gear:hover{ background:#20242d; color:#e6e8ec; } .hd{ border-color:#2a2f3a; } }
.count{ font-size:12px; color:#6b7280; display:flex; align-items:center; gap:7px; }
.count b{ color:#171a21; font-size:13.5px; }
@media (prefers-color-scheme:dark){ .count b{ color:#e6e8ec; } }
.pulse{ width:7px;height:7px;border-radius:50%;background:#5457d6;box-shadow:0 0 0 3px #5457d622; }
.fill2{ display:grid; grid-template-columns:1fr 1fr; gap:9px; }
.fill{ display:flex; flex-direction:column; gap:2px; border:none; border-radius:11px; padding:11px 10px; cursor:pointer; text-align:center; align-items:center; }
.fill:disabled{ opacity:.55; cursor:not-allowed; }
.fill .big{ font-size:12.5px; font-weight:700; }
.fill .sm{ font-size:10px; font-weight:500; opacity:.85; }
.fill.p{ background:#5457d6; color:#fff; } .fill.p:hover:not(:disabled){ filter:brightness(1.06); }
.fill.a{ background:#fff; color:#171a21; border:1px solid #5457d6; } .fill.a .big{ color:#5457d6; }
.fill.solo{ grid-column:1/-1; }
.result{ font-size:11px; color:#6b7280; display:flex; gap:6px; align-items:center; flex-wrap:wrap; justify-content:center; }
.chip{ display:inline-flex; align-items:center; gap:5px; font-size:10.5px; font-weight:700; padding:3px 8px; border-radius:999px; }
.chip.ok{ background:#0f9d6b1f; color:#0f9d6b; } .chip.rev{ background:#c2740c1f; color:#c2740c; }
.ins{ border:1px solid #e3e6ec; border-radius:11px; overflow:hidden; }
.ins summary{ list-style:none; cursor:pointer; display:flex; align-items:center; gap:9px; padding:9px 12px; font-size:12px; font-weight:600; color:#171a21; }
.ins summary::-webkit-details-marker{ display:none; }
@media (prefers-color-scheme:dark){ .ins summary{ color:#e6e8ec; } }
.ins .car{ transition:transform .2s; color:#9aa1ac; font-size:11px; } .ins[open] .car{ transform:rotate(90deg); }
.ins .peek{ margin-left:auto; display:flex; gap:6px; align-items:center; }
.ins .body{ padding:11px 12px; display:flex; flex-direction:column; gap:11px; border-top:1px solid #e3e6ec; font-size:12px; color:#6b7280; }
.match{ display:flex; align-items:center; gap:12px; }
.ring{ width:54px;height:54px;border-radius:50%;flex:none;display:grid;place-items:center;position:relative; background:conic-gradient(#0f9d6b 0%, #e3e6ec 0); }
.ring::after{ content:""; position:absolute; inset:5px; background:#fff; border-radius:50%; }
@media (prefers-color-scheme:dark){ .ring::after{ background:#171a21; } }
.ring .v{ position:relative; z-index:1; font-weight:800; font-size:14px; color:#171a21; }
@media (prefers-color-scheme:dark){ .ring .v{ color:#e6e8ec; } }
.visa{ display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:700; color:#0f9d6b; background:#0f9d6b1f; padding:4px 9px; border-radius:999px; }
.kw{ display:flex; flex-wrap:wrap; gap:5px; } .kw span{ font-size:10.5px; padding:2px 7px; border-radius:6px; font-weight:500; }
.kw .have{ background:#0f9d6b1f; color:#0f9d6b; } .kw .gap{ background:#c2740c1f; color:#c2740c; }
.mini{ display:flex; gap:8px; }
.mini button{ flex:1; display:flex; align-items:center; justify-content:center; gap:6px; border:1px solid #e3e6ec; background:#fff; color:#6b7280; border-radius:9px; padding:7px; font-size:11.5px; font-weight:600; cursor:pointer; }
.mini button:hover{ border-color:#5457d6; color:#171a21; }
.sitecap{ display:flex; align-items:center; gap:7px; font-size:11px; color:#6b7280; cursor:pointer; }
.foot{ border-top:1px solid #e3e6ec; padding:9px 13px; font-size:10.5px; color:#9aa1ac; line-height:1.5; background:#f6f7f9; }
.foot a{ color:#5457d6; text-decoration:none; font-weight:600; cursor:pointer; }
.bubble{ position:fixed; top:76px; right:16px; z-index:2147483647; width:44px;height:44px;border-radius:50%; background:linear-gradient(135deg,#5457d6,#0f9d6b); color:#fff; display:grid;place-items:center; cursor:pointer; box-shadow:0 10px 30px -8px rgba(84,87,214,.6); font-size:18px; border:none; }
.bubble.test{ background:linear-gradient(135deg,#c2740c,#e0952f); }
.bubble .b{ position:absolute; top:-4px; right:-4px; background:#0f9d6b; color:#fff; font-size:10px; font-weight:800; min-width:16px;height:16px;border-radius:999px; display:grid;place-items:center; padding:0 3px; border:2px solid #fff; }
.hidden{ display:none !important; }
`;

export function mountPanel(deps: PanelDeps): { update: () => void; setVisible: (v: boolean) => void } {
  const host = document.createElement('div');
  host.id = 'f2a-panel-host';
  host.style.display = 'none'; // revealed via setVisible() only on relevant pages
  const sr = host.attachShadow({ mode: 'open' });
  sr.innerHTML = `
    <style>${STYLE}</style>
    <button class="bubble hidden" id="bubble">⚡<span class="b" id="bubbleCount">0</span></button>
    <div class="wrap" id="wrap">
      <div class="card">
        <div class="testbar hidden" id="testbar"><span class="d"></span>TEST DATA — filling anonymous dummy values</div>
        <div class="hd">
          <span class="mk">⚡</span><span class="nm">First2Apply</span><span class="ver" id="ver"></span>
          <span class="conn none" id="conn"><span class="d"></span><span id="connLabel"></span></span>
          <button class="gear" id="gear" title="Settings">⚙</button>
          <button class="x" id="collapse" title="Collapse">–</button>
        </div>
        <div class="bd">
          <div class="jobline hidden" id="jobline"></div>
          <div class="count"><span class="pulse"></span><b id="fieldCount">0</b> fillable fields</div>

          <div class="fill2" id="fill2">
            <button class="fill p" id="autofill"><span class="big">⚡ Autofill</span><span class="sm">+ my résumé</span></button>
            <button class="fill a hidden" id="autofillAts"><span class="big">✨ Autofill + ATS</span><span class="sm">tailored résumé</span></button>
          </div>
          <div class="result" id="fillResult"></div>

          <details class="ins hidden" id="insights">
            <summary><span class="car">▸</span> Job insights <span class="peek" id="insPeek"></span></summary>
            <div class="body" id="insBody">Analyzing…</div>
          </details>

          <div class="mini hidden" id="mini">
            <button id="draft">✍️ Draft answer</button>
            <button id="save">📌 Save job</button>
          </div>

          <label class="sitecap hidden" id="siteCapRow"><input type="checkbox" id="siteCap" /> Capture applications on this site (anonymized, local)</label>

          <div class="mini hidden" id="captureRow">
            <button id="capture">📸 Capture fixture (dev)</button>
          </div>
          <div class="result hidden" id="captureResult"></div>
        </div>
        <div class="foot" id="foot"></div>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (id: string) => sr.getElementById(id) as HTMLElement;
  const wrap = $('wrap');
  const bubble = $('bubble') as HTMLButtonElement;
  ($('ver') as HTMLElement).textContent = deps.version ? `v${deps.version}` : '';

  const setCollapsed = (c: boolean) => {
    wrap.classList.toggle('hidden', c);
    bubble.classList.toggle('hidden', !c);
  };
  $('collapse').addEventListener('click', () => setCollapsed(true));
  bubble.addEventListener('click', () => setCollapsed(false));
  $('gear').addEventListener('click', () => deps.onOpenOptions());

  // ── autofill (default + ATS) ──────────────────────────────
  async function runFill(btn: HTMLButtonElement, mode: 'default' | 'ats', label: string) {
    btn.disabled = true;
    const big = btn.querySelector('.big') as HTMLElement;
    const prev = big.textContent;
    big.textContent = mode === 'ats' ? 'Tailoring…' : 'Filling…';
    const r = await deps.onAutofill(mode);
    big.textContent = prev;
    btn.disabled = false;
    $('fillResult').innerHTML = r
      ? `<span class="chip ok">✓ ${r.filled} filled</span>${r.review ? `<span class="chip rev">${r.review} to review</span>` : ''}`
      : 'Set up your profile in Settings first.';
    void label;
  }
  ($('autofill') as HTMLButtonElement).addEventListener('click', (e) => runFill(e.currentTarget as HTMLButtonElement, 'default', 'Autofill'));
  ($('autofillAts') as HTMLButtonElement).addEventListener('click', (e) => runFill(e.currentTarget as HTMLButtonElement, 'ats', 'ATS'));

  // ── insights (lazy: analyze on first expand) ──────────────
  const insights = $('insights') as HTMLDetailsElement;
  let analyzed = false;
  insights.addEventListener('toggle', async () => {
    if (!insights.open || analyzed) return;
    analyzed = true;
    const r = await deps.onAnalyze();
    const body = $('insBody');
    if (!r || r.error) {
      body.textContent = r?.error ?? 'Could not analyze this page.';
      analyzed = false;
      return;
    }
    const pct = typeof r.ats === 'number' ? r.ats : null;
    const parts: string[] = [];
    if (pct != null) {
      parts.push(
        `<div class="match"><div class="ring" style="background:conic-gradient(#0f9d6b ${pct}%, #e3e6ec 0)"><span class="v">${pct}%</span></div><div><div style="font-size:10px;text-transform:uppercase;letter-spacing:.09em;font-weight:700">ATS match</div><div style="margin-top:2px">Recomputed for this posting</div></div></div>`,
      );
    }
    if (r.visa) parts.push(`<div><span class="visa">🛂 ${r.visa}</span></div>`);
    if (r.keywords && (r.keywords.have.length || r.keywords.gap.length)) {
      const chips = [...r.keywords.have.slice(0, 6).map((k) => `<span class="have">${esc(k)}</span>`), ...r.keywords.gap.slice(0, 6).map((k) => `<span class="gap">${esc(k)}</span>`)].join('');
      parts.push(`<div><div style="font-size:10px;text-transform:uppercase;letter-spacing:.09em;font-weight:700;margin-bottom:6px">🎯 Keywords</div><div class="kw">${chips}</div></div>`);
    }
    body.innerHTML = parts.length ? parts.join('') : 'No signal for this page.';
    updatePeek(r);
  });

  function updatePeek(r: Insights) {
    const peek = $('insPeek');
    const bits: string[] = [];
    if (typeof r.ats === 'number') bits.push(`<span class="chip ok">${r.ats}% match</span>`);
    if (r.visa) bits.push(`<span class="visa" style="font-size:9.5px;padding:2px 6px">🛂</span>`);
    peek.innerHTML = bits.join('');
  }

  const mini = $('mini');
  ($('draft') as HTMLButtonElement).addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.textContent = 'Drafting…';
    const r = await deps.onDraft();
    b.textContent = r?.ok ? '✓ Drafted' : r?.error ? '⚠ ' + r.error.slice(0, 18) : '✍️ Draft answer';
  });
  ($('save') as HTMLButtonElement).addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.textContent = 'Saving…';
    const r = await deps.onSave();
    b.textContent = r?.ok ? '✓ Saved' : '📌 Save job';
  });

  const siteCap = $('siteCap') as HTMLInputElement;
  siteCap.addEventListener('change', () => deps.onToggleCaptureSite?.(siteCap.checked));

  ($('capture') as HTMLButtonElement).addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.textContent = 'Capturing…';
    const r = await deps.onCapture();
    b.textContent = '📸 Capture fixture (dev)';
    const out = $('captureResult');
    out.classList.remove('hidden');
    out.textContent = r ? `Saved fixture + coverage · resolved ${r.resolved}/${r.total}${r.unresolved ? ` · ${r.unresolved} to teach` : ''}` : 'Capture failed.';
  });

  const update = () => {
    const s = deps.getState();
    const connected = s.mode === 'connected';
    ($('fieldCount') as HTMLElement).textContent = String(s.fields);
    ($('bubbleCount') as HTMLElement).textContent = String(s.fields);
    $('testbar').classList.toggle('hidden', !s.testMode);
    bubble.classList.toggle('test', !!s.testMode);

    // connection indicator
    const conn = $('conn');
    conn.className = `conn ${s.mode}`;
    ($('connLabel') as HTMLElement).textContent = connected ? 'Connected' : 'Standalone';

    // job line
    const job = s.job;
    const jl = $('jobline');
    if (job && (job.title || job.company)) {
      jl.classList.remove('hidden');
      jl.innerHTML = `📍 <b>${esc(job.title || job.company || '')}</b>${job.title && job.company ? ` · ${esc(job.company!)}` : ''}${job.url ? ` <a class="lk" href="${esc(job.url)}" target="_blank" rel="noopener" style="margin-left:auto;color:#5457d6;text-decoration:none">🔗</a>` : ''}`;
    } else {
      jl.classList.add('hidden');
    }

    // connected-only surfaces
    $('autofillAts').classList.toggle('hidden', !connected);
    $('insights').classList.toggle('hidden', !connected);
    $('mini').classList.toggle('hidden', !connected);
    void mini;

    // capture-site opt-in
    const cs = s.captureSite;
    $('siteCapRow').classList.toggle('hidden', !cs?.show);
    if (cs?.show) siteCap.checked = cs.optedIn;
    // dev capture-fixture button
    $('captureRow').classList.toggle('hidden', !s.captureMode);

    $('foot').innerHTML = connected
      ? 'Never auto-submits — you review first. AI runs through your desktop app.'
      : s.mode === 'standalone'
        ? '<a id="footConnect">Connect the desktop app</a> for ATS match, visa signal &amp; a tailored résumé.'
        : 'Add your profile in Settings to autofill. Connect the app for AI + résumé.';
    const fc = sr.getElementById('footConnect');
    if (fc) fc.addEventListener('click', () => deps.onOpenOptions());
  };
  update();
  // Show the panel only on relevant (application) pages; hidden elsewhere.
  const setVisible = (v: boolean) => {
    host.style.display = v ? '' : 'none';
  };
  return { update, setVisible };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
