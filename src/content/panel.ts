/**
 * The docked on-page panel (Phase 7.3). Rendered inside a shadow root so the host
 * page's CSS can't affect it. Presentational — logic lives in content.ts and is
 * passed as callbacks. Collapses to a small bubble.
 */

export type PanelState = {
  mode: 'connected' | 'standalone' | 'none';
  fields: number;
  testMode?: boolean;
  captureMode?: boolean;
  captureSite?: { show: boolean; optedIn: boolean };
};

export type PanelDeps = {
  version?: string;
  getState: () => PanelState;
  onAutofill: () => Promise<{ filled: number; review: number; total: number } | null>;
  onAnalyze: () => Promise<{ ats?: number | null; visa?: string; error?: string } | null>;
  onCapture: () => Promise<{ total: number; resolved: number; unresolved: number; unresolvedLabels: string[] } | null>;
  onToggleCaptureSite?: (on: boolean) => void;
  onOpenOptions: () => void;
};

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.wrap { position: fixed; top: 76px; right: 16px; width: 320px; z-index: 2147483647; }
.card { background: #fff; color: #171a21; border: 1px solid #e3e6ec; border-radius: 14px; box-shadow: 0 16px 48px -16px rgba(20,24,40,.35), 0 2px 8px -2px rgba(20,24,40,.15); overflow: hidden; }
@media (prefers-color-scheme: dark) { .card { background:#171a21; color:#e6e8ec; border-color:#2a2f3a; } .sub{color:#9aa1ac!important;} .btn.ghost{color:#e6e8ec!important;border-color:#2a2f3a!important;} .row{border-color:#2a2f3a!important;} .note{background:#1d212a!important;} }
.hd { display:flex; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid #e3e6ec; }
.mark { width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#5457d6,#0f9d6b);display:grid;place-items:center;color:#fff;font-size:12px; }
.nm { font-weight:700; font-size:13.5px; letter-spacing:-.01em; }
.ver { font-size:10px; color:#9aa1ac; font-weight:600; }
.dot { width:7px;height:7px;border-radius:50%; margin-left:auto; }
.dot.connected{background:#0f9d6b;box-shadow:0 0 0 3px #0f9d6b22;}
.dot.standalone{background:#5457d6;box-shadow:0 0 0 3px #5457d622;}
.dot.none{background:#c2740c;box-shadow:0 0 0 3px #c2740c22;}
.x { cursor:pointer; font-size:16px; color:#9aa1ac; padding:0 2px; line-height:1; background:none;border:none; }
.bd { padding:14px; display:flex; flex-direction:column; gap:11px; }
.count { font-size:13px; } .count b{font-size:15px;}
.sub { font-size:11.5px; color:#6b7280; line-height:1.45; }
.btn { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; border-radius:9px; padding:10px 12px; font-size:13px; font-weight:600; cursor:pointer; border:1px solid transparent; }
.btn.primary { background:#5457d6; color:#fff; } .btn.primary:hover{filter:brightness(1.06);} .btn:disabled{opacity:.5;cursor:not-allowed;}
.btn.ghost { background:transparent; color:#171a21; border-color:#e3e6ec; }
.row { border-top:1px solid #e3e6ec; padding-top:11px; display:flex; flex-direction:column; gap:8px; }
.note { background:#f6f7f9; border-radius:9px; padding:9px 11px; font-size:11.5px; color:#6b7280; line-height:1.45; }
.sitecap { display:flex; align-items:center; gap:7px; font-size:11.5px; color:#6b7280; cursor:pointer; }
.result { font-size:12.5px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.chip { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600; padding:3px 9px; border-radius:999px; }
.chip.ok{background:#0f9d6b1f;color:#0f9d6b;} .chip.warn{background:#c2740c1f;color:#c2740c;}
.bubble { position:fixed; top:76px; right:16px; z-index:2147483647; width:44px;height:44px;border-radius:50%;
  background:linear-gradient(135deg,#5457d6,#0f9d6b); color:#fff; display:grid;place-items:center; cursor:pointer;
  box-shadow:0 10px 30px -8px rgba(84,87,214,.6); font-size:18px; border:none; position:relative; }
.bubble .b { position:absolute; top:-4px; right:-4px; background:#0f9d6b; color:#fff; font-size:10px; font-weight:800; min-width:16px;height:16px;border-radius:999px; display:grid;place-items:center; padding:0 3px; border:2px solid #fff; }
.testbar { display:flex; align-items:center; gap:7px; background:#c2740c; color:#fff; font-size:11.5px; font-weight:700; padding:7px 12px; letter-spacing:.01em; }
.testbar .d { width:7px;height:7px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px #ffffff44; }
.bubble.test { background:linear-gradient(135deg,#c2740c,#e0952f); box-shadow:0 10px 30px -8px rgba(194,116,12,.6); }
.hidden { display:none !important; }
`;

export function mountPanel(deps: PanelDeps): { update: () => void } {
  const host = document.createElement('div');
  host.id = 'f2a-panel-host';
  const sr = host.attachShadow({ mode: 'open' });
  sr.innerHTML = `
    <style>${STYLE}</style>
    <button class="bubble hidden" id="bubble">⚡<span class="b" id="bubbleCount">0</span></button>
    <div class="wrap" id="wrap">
      <div class="card">
        <div class="testbar hidden" id="testbar"><span class="d"></span>TEST DATA — filling anonymous dummy values</div>
        <div class="hd">
          <span class="mark">⚡</span><span class="nm">First2Apply</span>
          <span class="ver" id="ver">${deps.version ? `v${deps.version}` : ''}</span>
          <span class="dot none" id="dot" title=""></span>
          <button class="x" id="collapse" title="Collapse">–</button>
        </div>
        <div class="bd">
          <div class="count"><b id="fieldCount">0</b> fillable field(s) on this page</div>
          <button class="btn primary" id="autofill">⚡ Autofill this page</button>
          <div class="sub" id="fillResult"></div>
          <div class="row" id="aiRow">
            <div id="aiConnected" class="hidden">
              <button class="btn ghost" id="analyze">🎯 Analyze this job (ATS + visa)</button>
              <div class="result" id="aiResult" style="margin-top:8px"></div>
            </div>
            <div class="note" id="aiNote">Connect the desktop app (Options) to unlock ATS match, visa signal &amp; a tailored résumé.</div>
          </div>
          <label class="sitecap hidden" id="siteCapRow"><input type="checkbox" id="siteCap" /> Capture applications on this site (anonymized, local)</label>
          <div class="row hidden" id="captureRow">
            <button class="btn ghost" id="capture">📸 Capture fixture (dev)</button>
            <div class="sub" id="captureResult"></div>
          </div>
          <div class="sub" id="modeNote"></div>
        </div>
      </div>
    </div>`;
  document.documentElement.appendChild(host);

  const $ = (id: string) => sr.getElementById(id) as HTMLElement;
  const wrap = $('wrap');
  const bubble = $('bubble') as HTMLButtonElement;

  const setCollapsed = (c: boolean) => {
    wrap.classList.toggle('hidden', c);
    bubble.classList.toggle('hidden', !c);
  };
  $('collapse').addEventListener('click', () => setCollapsed(true));
  bubble.addEventListener('click', () => setCollapsed(false));

  const autofillBtn = $('autofill') as HTMLButtonElement;
  autofillBtn.addEventListener('click', async () => {
    autofillBtn.disabled = true;
    autofillBtn.textContent = 'Filling…';
    const r = await deps.onAutofill();
    autofillBtn.disabled = false;
    autofillBtn.textContent = '⚡ Autofill this page';
    $('fillResult').textContent = r
      ? `Filled ${r.filled}${r.review ? ` · ${r.review} to review` : ''} of ${r.total}.`
      : 'Set up your profile in Options first.';
  });

  const analyzeBtn = $('analyze') as HTMLButtonElement;
  analyzeBtn.addEventListener('click', async () => {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing…';
    const r = await deps.onAnalyze();
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = '🎯 Analyze this job (ATS + visa)';
    const out = $('aiResult');
    if (!r || r.error) {
      out.textContent = r?.error ?? 'Could not analyze this page.';
    } else {
      out.innerHTML = '';
      if (typeof r.ats === 'number') out.innerHTML += `<span class="chip ok">ATS ${r.ats}%</span>`;
      if (r.visa) out.innerHTML += `<span class="chip ok">${r.visa}</span>`;
      if (r.ats == null && !r.visa) out.textContent = 'No signal for this page.';
    }
  });

  const captureBtn = $('capture') as HTMLButtonElement;
  captureBtn.addEventListener('click', async () => {
    captureBtn.disabled = true;
    captureBtn.textContent = 'Capturing…';
    const r = await deps.onCapture();
    captureBtn.disabled = false;
    captureBtn.textContent = '📸 Capture fixture (dev)';
    if (!r) {
      $('captureResult').textContent = 'Capture failed.';
    } else {
      const miss = r.unresolvedLabels.slice(0, 3).join(', ');
      $('captureResult').innerHTML =
        `Saved fixture + coverage. Resolved <b>${r.resolved}/${r.total}</b>.` +
        (r.unresolved ? `<br>${r.unresolved} to teach${miss ? `: ${miss}${r.unresolvedLabels.length > 3 ? '…' : ''}` : ''}` : '');
    }
  });

  const siteCap = $('siteCap') as HTMLInputElement;
  siteCap.addEventListener('change', () => deps.onToggleCaptureSite?.(siteCap.checked));

  $('modeNote').addEventListener('click', () => {}); // reserved
  const openOptions = () => deps.onOpenOptions();
  $('aiNote').addEventListener('click', openOptions);

  const update = () => {
    const s = deps.getState();
    $('fieldCount').textContent = String(s.fields);
    ($('bubbleCount') as HTMLElement).textContent = String(s.fields);
    $('testbar').classList.toggle('hidden', !s.testMode);
    bubble.classList.toggle('test', !!s.testMode);
    $('captureRow').classList.toggle('hidden', !s.captureMode);
    const cs = s.captureSite;
    $('siteCapRow').classList.toggle('hidden', !cs?.show);
    if (cs?.show) (siteCap as HTMLInputElement).checked = cs.optedIn;
    const dot = $('dot');
    dot.className = `dot ${s.mode}`;
    dot.title = s.mode === 'connected' ? 'Connected to desktop app' : s.mode === 'standalone' ? 'Standalone (local profile)' : 'No profile set';
    $('aiConnected').classList.toggle('hidden', s.mode !== 'connected');
    $('aiNote').classList.toggle('hidden', s.mode === 'connected');
    $('modeNote').textContent =
      s.mode === 'connected'
        ? 'Connected to the desktop app — AI + your résumé.'
        : s.mode === 'standalone'
          ? 'Standalone mode — autofill from your saved profile. Connect the desktop app for AI.'
          : 'No profile yet — add one in Options to autofill.';
  };
  update();
  return { update };
}
