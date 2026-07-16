// Inline H-1B sponsor badges for LinkedIn. Because a company name is on EVERY job tile
// (unlike the JD), this can flag the whole list — one green "✓ H-1B sponsor" pill per tile,
// or next to the company on a single job page. Data is a compact list bundled in the
// extension (service worker owns it); matching sums a company's exact + word-prefix entries.
// Only active when the user turns on "I need visa sponsorship".
//
// This is a COMPANY-level signal (has this employer sponsored H-1B before?). It does NOT mean
// a specific role offers sponsorship — the red "won't sponsor" mark (from the JD) is the
// authoritative per-role override and can appear on the same tile.

const BADGE_CLASS = 'f2a-h1b-badge';
// company → approvals, cached so re-injecting after a React re-render doesn't re-query the SW
const cache = new Map<string, number>();

/** Is our badge already among the anchor's next few siblings? (The red mark can sit between
 *  the anchor and our badge, so check a small window, not just the immediate sibling.) */
function isBadged(el: HTMLElement): boolean {
  let n = el.nextElementSibling as HTMLElement | null;
  for (let i = 0; i < 4 && n; i++, n = n.nextElementSibling as HTMLElement | null) {
    if (n.classList?.contains(BADGE_CLASS)) return true;
  }
  return false;
}

// company-link texts that aren't a company name
const NOISE = /^(show|see|view|follow|premium|\+|\d)/i;

function cleanCompany(text: string): string {
  const first = (text || '').split('\n')[0].trim();
  return first
    .replace(/\s*·.*$/, '')
    .replace(/\s*\d[\d,]*\s*(followers|employees).*$/i, '')
    .trim();
}

// Where a company name lives inside a tile — a /company/ link, or (list cards) a subtitle text.
const COMPANY_SELECTORS = ['a[href*="/company/"]', '.artdeco-entity-lockup__subtitle', '[class*="primary-description"]', '[class*="company-name"]', '[class*="subtitle"]'];

const valid = (c: string) => !!c && c.length <= 60 && !NOISE.test(c);

/** Company + a place to badge inside one tile. Class-agnostic (LinkedIn obfuscates classes):
 *  tries known company elements, else falls back to the tile's 2nd text line (title, COMPANY, …). */
function tileTarget(tile: HTMLElement, titleLink: HTMLElement): { el: HTMLElement; company: string } | null {
  for (const sel of COMPANY_SELECTORS) {
    const el = tile.querySelector<HTMLElement>(sel);
    if (el) {
      const c = cleanCompany(el.textContent || '');
      if (valid(c)) return { el, company: c };
    }
  }
  const lines = (tile.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const c = cleanCompany(lines[1] || ''); // line 0 is the title; the company usually follows
  return valid(c) ? { el: titleLink, company: c } : null;
}

/** Best-effort per-tile targets (search list). Class-agnostic: anchor on the job-title link. */
function tileTargets(): { el: HTMLElement; company: string }[] {
  const out: { el: HTMLElement; company: string }[] = [];
  const seen = new Set<HTMLElement>();
  for (const link of document.querySelectorAll<HTMLElement>('li a[href*="/jobs/view/"]')) {
    const li = link.closest('li');
    if (!li || seen.has(li)) continue;
    seen.add(li);
    const t = tileTarget(li, link);
    if (t) out.push(t);
  }
  return out;
}

/** The OPENED job's company (detail pane / single job page) — a /company/ link that is NOT
 *  inside a list tile. This is the reliable surface that drives the badge + the popup verdict. */
function detailCompany(): { el: HTMLElement; company: string } | null {
  const links = Array.from(document.querySelectorAll<HTMLElement>('a[href*="/company/"]'));
  const inTile = (a: HTMLElement) => !!a.closest('li[data-occludable-job-id], .job-card-container, li.scaffold-layout__list-item, .jobs-search-results__list-item');
  for (const a of links) {
    if (inTile(a)) continue;
    const c = cleanCompany(a.textContent || '');
    if (valid(c)) return { el: a, company: c };
  }
  for (const a of links) {
    const c = cleanCompany(a.textContent || '');
    if (valid(c)) return { el: a, company: c };
  }
  return null;
}

function badge(approvals: number): HTMLElement {
  const b = document.createElement('span');
  b.className = BADGE_CLASS;
  b.textContent = `✓ H-1B sponsor${approvals >= 5 ? ` · ${approvals.toLocaleString()}` : ''}`;
  b.title = `This employer has ${approvals.toLocaleString()} H-1B approval(s) on record (USCIS). Company-level signal — a specific role may still not sponsor (see any red flag).`;
  Object.assign(b.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    margin: '0 6px',
    padding: '1px 7px',
    borderRadius: '999px',
    background: '#0f9d6b',
    color: '#fff',
    font: '700 10.5px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    verticalAlign: 'middle',
    cursor: 'help',
  });
  b.style.setProperty('display', 'inline-flex', 'important'); // defeat host CSS that could hide it
  b.style.setProperty('visibility', 'visible', 'important');
  return b;
}

let lastH1b: { company: string; approvals: number } | null = null;
/** H-1B match for the current/opened job's company (for the popup's chip). */
export function getH1bVerdict(): { company: string; approvals: number } | null {
  return lastH1b;
}

/**
 * Look up each visible job's company against the bundled H-1B list (via the service worker)
 * and add a green sponsor badge. Idempotent per anchor. When `active` is false, clears the
 * current verdict (existing page badges are left as-is).
 */
export async function applyH1bBadges(active: boolean): Promise<void> {
  if (!active) {
    lastH1b = null;
    return;
  }
  const detail = detailCompany(); // the opened job's company — reliable, drives the popup verdict
  const targets = [...tileTargets(), ...(detail ? [detail] : [])];
  if (!targets.length) return;
  // look up only companies we haven't cached yet (cheap across the frequent re-render re-scans)
  const unknown = Array.from(new Set(targets.map((t) => t.company).filter((c) => !cache.has(c))));
  if (unknown.length) {
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'f2a-h1b', companies: unknown })) as { matches?: Record<string, number> } | undefined;
      const matches = res?.matches ?? {};
      for (const c of unknown) cache.set(c, matches[c] ?? 0);
    } catch {
      return; // service worker unavailable — retry on the next scan
    }
  }
  // (Re-)inject wherever our badge is missing — React re-renders wipe injected nodes, so we
  // key idempotency on the badge actually being present, not on a one-time "marked" flag.
  for (const { el, company } of targets) {
    const approvals = cache.get(company) ?? 0;
    if (approvals > 0 && !isBadged(el)) el.insertAdjacentElement('afterend', badge(approvals));
  }
  if (detail) {
    const a = cache.get(detail.company) ?? 0;
    lastH1b = a > 0 ? { company: detail.company, approvals: a } : null;
  }
}
