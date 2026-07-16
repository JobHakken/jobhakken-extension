// Client-side "won't sponsor" detection for LinkedIn (and generic career sites). Shares the
// EXACT classifier the desktop feed uses (@first2apply/core) — imported by its specific,
// dependency-free file so the content-script bundle stays lean (the core package index is
// node-heavy and CJS). Only active when the user turns on "I need visa sponsorship".
//
// LinkedIn note: a job's full description loads only when it's opened, so we judge on open.
// Two surfaces: on the SEARCH page we mark (or hide) the job's list TILE; on a single job
// (detail) page there's no list, so we mark next to the job TITLE. The desktop feed hides
// won't-sponsor roles upfront (it has every job's full description).
import { classifyEligibility, type EligibilityCategory, type EligibilityResult } from '@first2apply/core/build/eligibility';

const MARK_ATTR = 'data-f2a-elig'; // 'marked' | 'hidden' — set on the anchor once handled

const LABELS: Record<EligibilityCategory, string> = {
  citizenship: 'U.S. citizenship',
  clearance: 'a security clearance',
  sponsorship: 'no visa sponsorship',
  export: 'export-control (ITAR/EAR)',
};

// LinkedIn ships obfuscated CSS classes with a STABLE id prefix `JobDetails_AboutTheJob_<id>`;
// older variants used `#job-details`. Generic career sites use a *job-description* container.
const JD_SELECTORS = [
  '[id^="JobDetails_AboutTheJob"]',
  '[id^="JobDetails"]',
  '#job-details',
  '.jobs-description__content',
  '.jobs-description-content__text',
  '[class*="jobs-description"]',
  '[data-testid*="jobDescription" i]',
  '[class*="job-description" i]',
];

/** textContent (not innerText) so a collapsed "…show more" clause is still read. */
function jdText(el: Element): string {
  return (el.textContent ?? '').trim();
}

function jdContainer(): HTMLElement | null {
  for (const sel of JD_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && jdText(el).length > 120) return el;
  }
  return null;
}

/** Job id — from the JD container id (works even on a saved file), else the URL. */
function jobIdFrom(jd: HTMLElement): string | null {
  const fromId = jd.id.match(/(\d{6,})/);
  if (fromId) return fromId[1];
  const q = new URLSearchParams(location.search).get('currentJobId');
  if (q) return q;
  const p = location.pathname.match(/\/jobs\/view\/(\d+)/);
  return p ? p[1] : null;
}

type Anchor = { kind: 'tile' | 'title'; el: HTMLElement };

const inTile = (a: HTMLElement) => !!a.closest('li[data-occludable-job-id], .job-card-container, li.scaffold-layout__list-item, .jobs-search-results__list-item, [data-job-id]');

/** The place to mark for this job. Preference: the opened job's COMPANY link in the detail pane
 *  (reliable + visible, and sits next to the green H-1B badge so both signals show together);
 *  else the list tile (search page); else the job-title link (single job page). */
function anchorFor(id: string | null): Anchor | null {
  // detail-pane company link (not inside a list tile) — where H-1B also renders
  const detailCo = Array.from(document.querySelectorAll<HTMLElement>('a[href*="/company/"]')).find((a) => {
    const t = (a.textContent ?? '').trim();
    return !inTile(a) && t.length > 0 && t.length < 60;
  });
  if (detailCo) return { kind: 'title', el: detailCo };
  if (id) {
    const byData = document.querySelector<HTMLElement>(`li[data-occludable-job-id="${id}"], [data-job-id="${id}"]`);
    if (byData) return { kind: 'tile', el: byData };
    const link = document.querySelector<HTMLElement>(`a[href*="/jobs/view/${id}"], a[href*="currentJobId=${id}"]`);
    if (link) {
      const tile = link.closest<HTMLElement>('.job-card-container, li[data-occludable-job-id], li.scaffold-layout__list-item, .jobs-search-results__list-item, [data-job-id]');
      if (tile) return { kind: 'tile', el: tile };
      return { kind: 'title', el: link }; // single job page — anchor to the title link
    }
  }
  return null;
}

function pill(cats: EligibilityCategory[]): HTMLElement {
  const p = document.createElement('span');
  p.className = 'f2a-elig-mark';
  p.textContent = '🛂 No sponsorship';
  // small by design; hover reveals the reason (people learn what it means over time)
  p.title = `Likely won't sponsor — this role requires ${cats.map((c) => LABELS[c]).join(', ')}.`;
  Object.assign(p.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    margin: '4px 6px',
    padding: '1px 7px',
    borderRadius: '999px',
    background: '#b91c1c',
    color: '#fff',
    font: '700 10.5px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    verticalAlign: 'middle',
    cursor: 'help',
  });
  p.style.setProperty('display', 'inline-flex', 'important'); // defeat host CSS that could hide it
  p.style.setProperty('visibility', 'visible', 'important');
  return p;
}

/** Is our red pill already present? (Check a small sibling window — the green H-1B badge can
 *  sit between the anchor and our pill — so we don't duplicate on every re-render re-scan.) */
function hasPill(anchor: Anchor): boolean {
  if (anchor.kind === 'tile') return !!anchor.el.querySelector('.f2a-elig-mark');
  let n = anchor.el.nextElementSibling as HTMLElement | null;
  for (let i = 0; i < 4 && n; i++, n = n.nextElementSibling as HTMLElement | null) {
    if (n.classList?.contains('f2a-elig-mark')) return true;
  }
  return false;
}

/** Mark (small red pill; + red rail on a tile) or hide the job's anchor. Idempotent by the
 *  pill actually being present, so it re-injects if a React re-render removed it. */
function handle(anchor: Anchor, cats: EligibilityCategory[], hide: boolean): void {
  const { kind, el } = anchor;
  if (hide && kind === 'tile') {
    if (el.style.display !== 'none') el.style.display = 'none';
    el.setAttribute(MARK_ATTR, 'hidden');
    return;
  }
  if (hasPill(anchor)) return; // still there — nothing to do
  if (kind === 'tile') {
    el.style.borderLeft = '3px solid #b91c1c';
    el.insertAdjacentElement('afterbegin', pill(cats));
  } else {
    el.insertAdjacentElement('afterend', pill(cats)); // next to the title / company
  }
}

let lastVerdict: EligibilityResult | null = null;
/** Verdict for the currently-open job (for the popup's compact indicator). */
export function getEligibilityVerdict(): EligibilityResult | null {
  return lastVerdict;
}

/**
 * Classify the open job's description; if it explicitly rules out sponsorship, mark (or hide)
 * its tile/title. Idempotent — safe to call on every DOM mutation / job switch. When `active`
 * is false it just clears the current verdict (existing page marks are left as-is).
 */
export function applyEligibilityFilter(active: boolean, hide: boolean): void {
  if (!active) {
    lastVerdict = null;
    return;
  }
  const jd = jdContainer();
  if (!jd) return; // not on a job view yet
  const result = classifyEligibility(jdText(jd));
  lastVerdict = result;
  if (!result.blocked) return;
  const anchor = anchorFor(jobIdFrom(jd));
  if (!anchor) return;
  handle(anchor, Array.from(new Set(result.reasons.map((r) => r.category))), hide);
}
