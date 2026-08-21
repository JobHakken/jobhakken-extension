/**
 * LinkedIn job-search TILE filters (#183/#190) — hide or dim search-result tiles by company,
 * keyword, or LinkedIn's own tile labels (Promoted, Reposted, Applied, Viewed, Dismissed).
 * Passive and live-page only, the same shape as content/hiringPosts.ts: nothing is fetched by us,
 * and nothing persists beyond the user's own rules (lib/jobTileFilterStore.ts) — no job data, no
 * company directory, no per-tile record.
 *
 * Reuses eligibility.ts's own reasoning for tile boundaries and hide-vs-mark, but is a separate
 * module: eligibility.ts answers "will this employer sponsor me", this answers "did I ask not to
 * see this" — different questions, different stores, and eligibility.ts is out of scope here (#183
 * "Out of scope").
 *
 * Verified against two real captures (see e2e/fixtures/linkedin/):
 *  - jobs-search.html — the PUBLIC (logged-out) /jobs/search page, 60 tiles, company resolved via
 *    `a.hidden-nested-link` inside `h4.base-search-card__subtitle`, no personalised labels.
 *  - jobs-collections-loggedin.html — a LOGGED-IN /jobs/collections/recommended/ page, 7 tiles,
 *    company resolved via `.artdeco-entity-lockup__subtitle`, carrying real Promoted (7) and
 *    Viewed (3) tile labels. Reposted/Applied/Dismissed use the identical `footer-item` mechanism
 *    Promoted/Viewed use, but neither fixture happens to contain a tile in that state — see the
 *    test file for what is and isn't fixture-verified.
 */

import {
  type JobTileFilterRules,
  type JobTileLabelKey,
  loadHideJobTiles,
  loadJobTileRules,
  loadShowHiddenJobTiles,
} from '../lib/jobTileFilterStore.js';

const HIDE_ATTR = 'data-f2a-jt-hidden';
const DIM_ATTR = 'data-f2a-jt-dim';
const NOTE_CLASS = 'f2a-jt-reason';

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function styleBlock(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, String(v), 'important');
}

/** Is the current tab a LinkedIn job SEARCH results page? Cheap URL check, before any DOM work —
 *  same discipline as hiringPosts.ts's isPostSearchPage(). Covers both real captures: the public
 *  `/jobs/search` page and the logged-in `/jobs/collections/...` page (e.g. "recommended"). */
export function isJobSearchPage(): boolean {
  if (!location.hostname.endsWith('linkedin.com')) return false;
  const p = location.pathname;
  return p.startsWith('/jobs/search') || p.startsWith('/jobs/collections');
}

export type DetectedTile = {
  el: HTMLElement;
  company: string;
  title: string;
  labels: Set<JobTileLabelKey>;
};

// The tile boundary: prefer the structural markers eligibility.ts/h1b.ts already anchor on, else
// fall back to the nearest <li> — the public jobs-search.html fixture wraps each card in a plain
// <li> with none of those classes, so without the fallback nothing would resolve there at all.
const TILE_SELECTOR =
  'li[data-occludable-job-id], li.scaffold-layout__list-item, .jobs-search-results__list-item, [data-job-id]';

function tileBoundary(a: HTMLElement): HTMLElement | null {
  return a.closest<HTMLElement>(TILE_SELECTOR) ?? a.closest<HTMLElement>('li');
}

// Company: public search fixture puts it in an `a.hidden-nested-link` inside the subtitle heading;
// the logged-in list fixture puts a bare text span in `.artdeco-entity-lockup__subtitle`. Try both,
// most-specific first, same multi-selector fallback pattern as eligibility.ts's JD_SELECTORS.
const COMPANY_SELECTORS = [
  'h4.base-search-card__subtitle a.hidden-nested-link',
  'h4.base-search-card__subtitle',
  '.artdeco-entity-lockup__subtitle',
  '.job-card-container__primary-description',
];

function companyOf(tile: HTMLElement): string {
  for (const sel of COMPANY_SELECTORS) {
    const t = clean(tile.querySelector(sel)?.textContent);
    if (t) return t;
  }
  return '';
}

const TITLE_SELECTORS = ['h3.base-search-card__title', '.job-card-list__title--link', '.job-card-container__link'];

function titleOf(tile: HTMLElement): string {
  for (const sel of TITLE_SELECTORS) {
    const t = clean(tile.querySelector(sel)?.textContent);
    if (t) return t;
  }
  // Fall back to the job-view anchor itself — covers a tile shape neither fixture happens to use.
  const a = tile.querySelector<HTMLElement>('a[href*="/jobs/view/"]');
  return clean(a?.textContent) || clean(a?.getAttribute('aria-label'));
}

// LinkedIn's own per-tile state labels sit in `<li class="job-card-container__footer-item ...">` —
// verified for Promoted/Viewed against the logged-in capture (7 Promoted, 3 Viewed tiles). Reposted
// and Applied are matched by the same mechanism (LinkedIn reuses this component for every tile
// label) but are NOT present in either committed fixture, so they're unverified against a real
// capture — flagged in the test file, not hidden here.
const FOOTER_ITEM_SELECTOR = '.job-card-container__footer-item';
// LinkedIn's own copy for a job the person dismissed ("X" / "Not interested"). Neither fixture
// contains a dismissed tile, so this is unverified against a real capture too. `.` (not a literal
// apostrophe) so both straight and curly apostrophes match — hiringPosts.ts hit exactly this bug
// with a literal apostrophe once (0.37.1) and it's cheap to avoid it here from the start.
const DISMISSED_RE = /we\s+won.t\s+show\s+you\s+this\s+job\s+again/i;

function labelsOf(tile: HTMLElement): Set<JobTileLabelKey> {
  const out = new Set<JobTileLabelKey>();
  for (const li of Array.from(tile.querySelectorAll(FOOTER_ITEM_SELECTOR))) {
    const t = clean(li.textContent).toLowerCase();
    if (t === 'promoted') out.add('promoted');
    else if (t === 'viewed') out.add('viewed');
    else if (t === 'applied' || t.startsWith('applied ')) out.add('applied');
    else if (t === 'reposted' || t.startsWith('reposted ')) out.add('reposted');
  }
  if (DISMISSED_RE.test(clean(tile.textContent))) out.add('dismissed');
  return out;
}

/** Detect job-search tiles on the current page, deduped by their resolved boundary element (a tile
 *  can carry more than one `/jobs/view/` anchor — an image link and a title link — that must
 *  collapse to the same entry, not count twice). */
export function detectTiles(root: ParentNode = document): DetectedTile[] {
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/view/"]'));
  const tiles = new Map<HTMLElement, true>();
  for (const a of anchors) {
    const t = tileBoundary(a);
    if (t) tiles.set(t, true);
  }
  return Array.from(tiles.keys()).map((el) => ({
    el,
    company: companyOf(el),
    title: titleOf(el),
    labels: labelsOf(el),
  }));
}

/**
 * The elements to actually fade. Not simply the tile: if LinkedIn (or a future markup change) ever
 * renders the tile wrapper as `display: contents`, opacity on it is a silent no-op — the exact bug
 * hiringPosts.ts hit and documents at length in its own boxesOf(). Neither captured fixture actually
 * ships `display: contents` on a tile (unlike the post cards), but the check is nearly free and a
 * future-proofing a dim feature needs by construction, not by re-discovering the same bug later.
 */
function boxesOf(el: HTMLElement): HTMLElement[] {
  const cs = getComputedStyle(el);
  if (cs.display !== 'contents') {
    // No layout under jsdom means every rect is all-zero; only demand real height when real layout
    // exists, same caveat hiringPosts.ts's boxesOf documents.
    const r = el.getBoundingClientRect();
    const hasLayout = r.width > 0 || r.height > 0 || r.top !== 0 || r.left !== 0;
    if (!hasLayout || r.height > 0) return [el];
  }
  const out: HTMLElement[] = [];
  for (const child of Array.from(el.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.classList.contains(NOTE_CLASS)) continue;
    out.push(...boxesOf(child));
  }
  return out;
}

function reasonNote(tile: HTMLElement, text: string): void {
  const existing = tile.querySelector(`.${NOTE_CLASS}`);
  if (existing) {
    if (existing.textContent !== text) existing.textContent = text;
    return;
  }
  const note = document.createElement('div');
  note.className = NOTE_CLASS;
  note.textContent = text;
  styleBlock(note, {
    font: '600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    color: '#98a2b3',
    padding: '4px 0',
  });
  tile.appendChild(note);
}

/** Hide a tile outright (only reached when the user has opted into "hide" over "dim"). */
function hideTile(tile: HTMLElement, reason: string): void {
  undimBoxes(tile); // clear any prior dim marks so a later dim→hide→dim cycle can't leave stragglers
  if (tile.style.display !== 'none') tile.style.setProperty('display', 'none', 'important');
  tile.setAttribute(HIDE_ATTR, '1');
  reasonNote(tile, `Hidden — ${reason}`);
}

/** Dim a tile in place (the default) and label why. Never removes it from the DOM — it's the
 *  person's own search results; this only de-emphasizes. Re-applies every pass rather than
 *  gating on a one-time flag, because LinkedIn resets the `style` attribute on re-render — the
 *  same idempotency lesson hiringPosts.ts's dim() documents. */
function dimTile(tile: HTMLElement, reason: string): void {
  if (tile.hasAttribute(HIDE_ATTR)) {
    tile.style.removeProperty('display');
    tile.removeAttribute(HIDE_ATTR);
  }
  for (const box of boxesOf(tile)) {
    box.style.setProperty('opacity', '0.35', 'important');
    box.setAttribute(DIM_ATTR, '1');
  }
  reasonNote(tile, `Hidden — ${reason}`);
}

function undimBoxes(tile: HTMLElement): void {
  const marked = Array.from(tile.querySelectorAll<HTMLElement>(`[${DIM_ATTR}]`));
  if (tile.hasAttribute(DIM_ATTR)) marked.push(tile);
  for (const el of marked) {
    el.style.removeProperty('opacity');
    el.removeAttribute(DIM_ATTR);
  }
}

/** Undo hide/dim entirely — a tile that no longer matches any rule must come all the way back,
 *  same restraint as hiringPosts.ts's undim(): a result left permanently faded because a rule was
 *  removed is worse than one never touched. */
function restore(tile: HTMLElement): void {
  if (tile.hasAttribute(HIDE_ATTR)) {
    tile.style.removeProperty('display');
    tile.removeAttribute(HIDE_ATTR);
  }
  undimBoxes(tile);
  tile.querySelector(`.${NOTE_CLASS}`)?.remove();
}

/** Does this tile match a rule, and if so, what should the person be told? Returns null for "leave
 *  it alone" — the one path that must never fire on a tile matching nothing (#183 acceptance
 *  criteria: a tile matching no rule is untouched). */
function matchReason(tile: DetectedTile, rules: JobTileFilterRules): string | null {
  const companyLc = tile.company.toLowerCase();
  const hitCompany = rules.companies.find((c) => c && companyLc.includes(c));
  if (hitCompany) return `company "${tile.company}"`;

  const titleLc = tile.title.toLowerCase();
  const hitKeyword = rules.keywords.find((k) => k && titleLc.includes(k));
  if (hitKeyword) return `matches keyword "${hitKeyword}"`;

  if (rules.labels.promoted && tile.labels.has('promoted')) return 'promoted';
  if (rules.labels.reposted && tile.labels.has('reposted')) return 'reposted';
  if (rules.labels.applied && tile.labels.has('applied')) return 'applied';
  if (rules.labels.viewed && tile.labels.has('viewed')) return 'viewed';
  if (rules.labels.dismissed && tile.labels.has('dismissed')) return "dismissed — you won't be shown this job again";

  return null;
}

export type JobTileFilterSummary = { shown: number; total: number };

/**
 * Run one pass over the current page: match every tile against the person's own rules, then hide
 * or dim (or restore) accordingly. Cheap URL gate first — must run before any DOM work, since this
 * is driven off the same mutation-observer callback that fires on every page the user has open.
 */
export async function applyJobTileFilters(): Promise<JobTileFilterSummary | null> {
  if (!isJobSearchPage()) return null;

  const rules = await loadJobTileRules();
  const hide = await loadHideJobTiles();
  const showHidden = await loadShowHiddenJobTiles();
  const tiles = detectTiles();

  let hiddenCount = 0;
  for (const tile of tiles) {
    const reason = matchReason(tile, rules);
    if (!reason) {
      restore(tile.el);
      continue;
    }
    hiddenCount++;
    // The #190 audit toggle wins over the hide preference: reveal every match, faded and labelled,
    // instead of trusting the rule blind.
    if (hide && !showHidden) hideTile(tile.el, reason);
    else dimTile(tile.el, reason);
  }

  return { shown: tiles.length - hiddenCount, total: tiles.length };
}
