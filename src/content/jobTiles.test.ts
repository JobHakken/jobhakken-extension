/**
 * @jest-environment jsdom
 *
 * LinkedIn job-search TILE filter (#183/#190). Two kinds of fixture are used deliberately:
 *  - the REAL captures committed at e2e/fixtures/linkedin/*.html, loaded verbatim, for the
 *    selectors that must survive contact with LinkedIn's actual markup (company/title resolution,
 *    tile boundary, and the real Promoted/Viewed labels);
 *  - small hand-built snippets — mirroring that same real structure — for behaviors no single real
 *    capture happens to exercise (Reposted/Applied/Dismissed labels, the display:contents fade bug,
 *    idempotency across a simulated re-render, and the "never touch a non-match" guarantee).
 * Identities in the hand-built snippets are placeholders (Jordan Rivera / example.com).
 */
import { readFileSync } from 'fs';
import path from 'path';

import { beforeEach, describe, expect, it } from '@jest/globals';

import { applyJobTileFilters, detectTiles, isJobSearchPage } from './jobTiles';

// tsconfig.spec.json compiles tests to CommonJS (jest.config.ts), so __dirname is available as the
// runtime global — not import.meta.url, which is an ESM-only construct the rest of the source uses.
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'e2e', 'fixtures', 'linkedin');

function setLocation(hostname: string, pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname, pathname, href: `https://${hostname}${pathname}` },
    writable: true,
  });
}

/** Load a REAL committed capture's <body> into the document, verbatim — no rewriting. */
function loadFixture(name: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- committed test fixture under a fixed dir
  const raw = readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
  const body = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = body ? body[1] : raw;
}

/** A chrome.storage.local fake that actually holds state across get/set, like the real thing. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: async (key: string) => ({ [key]: data[key] }),
    set: async (obj: Record<string, unknown>) => Object.assign(data, obj),
  };
}

function installChrome(storage = fakeStorage()): void {
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local: storage } };
}

/** A hand-built tile mirroring the real fixtures' structure: a `<li>` tile boundary, the public
 *  fixture's title/subtitle headings, and LinkedIn's own `footer-item` label component. */
function tile(opts: { jobId: string; title: string; company: string; labels?: string[]; extra?: string }): string {
  const { jobId, title, company, labels = [], extra = '' } = opts;
  const footer = labels.map((l) => `<li class="job-card-container__footer-item">${l}</li>`).join('');
  return `
    <li data-occludable-job-id="${jobId}">
      <a href="/jobs/view/${jobId}/"><h3 class="base-search-card__title">${title}</h3></a>
      <h4 class="base-search-card__subtitle"><a class="hidden-nested-link" href="/company/x">${company}</a></h4>
      <ul class="job-card-container__metadata-wrapper">${footer}</ul>
      ${extra}
    </li>`;
}

describe('isJobSearchPage', () => {
  it('is true on the public /jobs/search page', () => {
    setLocation('www.linkedin.com', '/jobs/search/');
    expect(isJobSearchPage()).toBe(true);
  });

  it('is true on a logged-in /jobs/collections/... page', () => {
    setLocation('www.linkedin.com', '/jobs/collections/recommended/');
    expect(isJobSearchPage()).toBe(true);
  });

  it('is false on LinkedIn’s post-search page — a different vertical', () => {
    setLocation('www.linkedin.com', '/search/results/content/');
    expect(isJobSearchPage()).toBe(false);
  });

  it('is false on a non-LinkedIn page', () => {
    setLocation('www.indeed.com', '/jobs/search/');
    expect(isJobSearchPage()).toBe(false);
  });
});

describe('detectTiles against the REAL public /jobs/search capture (jobs-search.html, 60 tiles)', () => {
  beforeEach(() => loadFixture('jobs-search.html'));

  it('finds exactly the 60 real tiles, deduped by tile boundary', () => {
    expect(detectTiles()).toHaveLength(60);
  });

  it('resolves company via a.hidden-nested-link inside h4.base-search-card__subtitle', () => {
    const tiles = detectTiles();
    const amd = tiles.find((t) => t.title.includes('Embedded Firmware Engineer') && t.company === 'AMD');
    expect(amd).toBeDefined();
  });

  it('carries no personalised labels on the logged-out page', () => {
    const tiles = detectTiles();
    expect(tiles.every((t) => t.labels.size === 0)).toBe(true);
  });
});

describe('detectTiles against the REAL logged-in collections capture (7 tiles)', () => {
  beforeEach(() => loadFixture('jobs-collections-loggedin.html'));

  it('finds exactly the 7 real tiles', () => {
    expect(detectTiles()).toHaveLength(7);
  });

  it('reads real Promoted (7) and Viewed (3) tile labels — this fixture’s whole point', () => {
    const tiles = detectTiles();
    expect(tiles.filter((t) => t.labels.has('promoted'))).toHaveLength(7);
    expect(tiles.filter((t) => t.labels.has('viewed'))).toHaveLength(3);
    // Documented, not asserted-as-a-bug: neither Applied, Reposted, nor a dismissed tile actually
    // occurs in this capture (the one "Reposted" string in the raw file is the OPEN job's own detail
    // pane, not a tile). Applied/Reposted/Dismissed detection is exercised below with hand-built
    // tiles using the same real `job-card-container__footer-item` mechanism, but is UNVERIFIED
    // against any committed real capture.
    expect(tiles.filter((t) => t.labels.has('applied'))).toHaveLength(0);
    expect(tiles.filter((t) => t.labels.has('reposted'))).toHaveLength(0);
    expect(tiles.filter((t) => t.labels.has('dismissed'))).toHaveLength(0);
  });

  it('resolves company via .artdeco-entity-lockup__subtitle', () => {
    const tiles = detectTiles();
    expect(tiles.some((t) => t.company === 'Applied Intuition')).toBe(true);
  });
});

describe('detectTiles against the REAL logged-in /jobs list capture (25 tiles)', () => {
  // This layout defeats every class-based hook: obfuscated class names, no `job-card-container`, no
  // `data-occludable-job-id`, no `.job-card-container__footer-item`, and the tiles are not <li>. It is
  // why the live page reported "Showing 0 of 0" while the two earlier fixtures passed. Detection is
  // anchored on the per-tile dismiss control instead, whose aria-label is an accessibility contract.
  beforeEach(() => {
    loadFixture('jobs-list-loggedin.html');
  });

  it('finds all 25 tiles with no class-based hook available', () => {
    expect(detectTiles()).toHaveLength(25);
  });

  it('takes the title from the dismiss control and the company from the line beneath it', () => {
    const first = detectTiles()[0];
    expect(first.title).toBe('Senior Embedded Firmware Engineer');
    expect(first.company).toBe('Atoms');
  });

  it('reads the Viewed labels that render as plain tile text here', () => {
    expect(detectTiles().filter((t) => t.labels.has('viewed'))).toHaveLength(6);
  });

  it('does not read the company "Applied Intuition" as an already-applied job', () => {
    // A loose word match did exactly that. The label is the bare word or the word plus a time.
    for (const tile of detectTiles()) {
      if (/^Applied\b/i.test(tile.company)) expect(tile.labels.has('applied')).toBe(false);
    }
  });
});

describe('applyJobTileFilters — matching, dimming, and the never-touch-a-non-match guarantee', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setLocation('www.linkedin.com', '/jobs/search/');
  });

  it('dims a tile matching a company rule and leaves a matching-nothing tile completely untouched', async () => {
    installChrome(fakeStorage({ f2a_jt_rules: { companies: ['apex staffing'], keywords: [], labels: {} } }));
    document.body.innerHTML =
      tile({ jobId: '1', title: 'Firmware Engineer', company: 'Apex Staffing' }) +
      tile({ jobId: '2', title: 'Firmware Engineer', company: 'Example Co' });

    const summary = await applyJobTileFilters();
    expect(summary).toEqual({ shown: 1, total: 2 });

    const hidden = document.querySelector('[data-occludable-job-id="1"]') as HTMLElement;
    const clean = document.querySelector('[data-occludable-job-id="2"]') as HTMLElement;

    expect(hidden.style.opacity).toBe('0.35');
    expect(hidden.querySelector('.f2a-jt-reason')?.textContent).toContain('Apex Staffing');

    // The failure that would actually hurt someone: a tile matching NOTHING must be untouched —
    // no opacity, no hide, no reason note, no marker attribute of any kind.
    expect(clean.style.opacity).toBe('');
    expect(clean.style.display).not.toBe('none');
    expect(clean.querySelector('.f2a-jt-reason')).toBeNull();
    expect(clean.hasAttribute('data-f2a-jt-dim')).toBe(false);
    expect(clean.hasAttribute('data-f2a-jt-hidden')).toBe(false);
  });

  it('matches a keyword rule against the title', async () => {
    installChrome(fakeStorage({ f2a_jt_rules: { companies: [], keywords: ['senior'], labels: {} } }));
    document.body.innerHTML = tile({ jobId: '1', title: 'Senior Firmware Engineer', company: 'Example Co' });

    await applyJobTileFilters();
    const t = document.querySelector('[data-occludable-job-id="1"]') as HTMLElement;
    expect(t.style.opacity).toBe('0.35');
    expect(t.querySelector('.f2a-jt-reason')?.textContent).toContain('senior');
  });

  it('matches Promoted / Reposted / Applied label rules via the real footer-item mechanism', async () => {
    installChrome(
      fakeStorage({
        f2a_jt_rules: {
          companies: [],
          keywords: [],
          labels: { promoted: true, reposted: true, applied: true, viewed: false, dismissed: false },
        },
      }),
    );
    document.body.innerHTML =
      tile({ jobId: '1', title: 'A', company: 'Co', labels: ['Promoted'] }) +
      tile({ jobId: '2', title: 'B', company: 'Co', labels: ['Reposted'] }) +
      tile({ jobId: '3', title: 'C', company: 'Co', labels: ['Applied'] }) +
      tile({ jobId: '4', title: 'D', company: 'Co', labels: ['Viewed'] }); // rule is off — must stay clean

    const summary = await applyJobTileFilters();
    expect(summary).toEqual({ shown: 1, total: 4 });
    for (const id of ['1', '2', '3']) {
      expect((document.querySelector(`[data-occludable-job-id="${id}"]`) as HTMLElement).style.opacity).toBe('0.35');
    }
    const viewedTile = document.querySelector('[data-occludable-job-id="4"]') as HTMLElement;
    expect(viewedTile.style.opacity).toBe('');
  });

  it('matches a dismissed tile via LinkedIn’s own copy, apostrophe-tolerant', async () => {
    installChrome(
      fakeStorage({
        f2a_jt_rules: { companies: [], keywords: [], labels: { dismissed: true } },
      }),
    );
    // A curly apostrophe (’), the exact character class hiringPosts.ts hit a false negative on
    // (0.37.1) — the regex must not assume a straight quote.
    document.body.innerHTML = tile({
      jobId: '1',
      title: 'A',
      company: 'Co',
      extra: '<p>We won’t show you this job again.</p>',
    });

    await applyJobTileFilters();
    expect((document.querySelector('[data-occludable-job-id="1"]') as HTMLElement).style.opacity).toBe('0.35');
  });

  it('HIDES outright only once the person opts into the hide preference (default is dim)', async () => {
    installChrome(
      fakeStorage({
        f2a_jt_rules: { companies: ['apex staffing'], keywords: [], labels: {} },
        f2a_hide_job_tiles: true,
      }),
    );
    document.body.innerHTML = tile({ jobId: '1', title: 'A', company: 'Apex Staffing' });

    await applyJobTileFilters();
    const t = document.querySelector('[data-occludable-job-id="1"]') as HTMLElement;
    expect(t.style.display).toBe('none');
  });

  it('the #190 "show hidden" audit toggle reveals a hidden match instead of hiding it', async () => {
    installChrome(
      fakeStorage({
        f2a_jt_rules: { companies: ['apex staffing'], keywords: [], labels: {} },
        f2a_hide_job_tiles: true,
        f2a_jt_show_hidden: true,
      }),
    );
    document.body.innerHTML = tile({ jobId: '1', title: 'A', company: 'Apex Staffing' });

    await applyJobTileFilters();
    const t = document.querySelector('[data-occludable-job-id="1"]') as HTMLElement;
    expect(t.style.display).not.toBe('none');
    expect(t.style.opacity).toBe('0.35');
    expect(t.querySelector('.f2a-jt-reason')?.textContent).toContain('Apex Staffing');
  });

  it('RE-APPLIES on every pass, repairing a dim LinkedIn wiped via a re-render', async () => {
    installChrome(fakeStorage({ f2a_jt_rules: { companies: ['apex staffing'], keywords: [], labels: {} } }));
    document.body.innerHTML = tile({ jobId: '1', title: 'A', company: 'Apex Staffing' });

    await applyJobTileFilters();
    const t = document.querySelector('[data-occludable-job-id="1"]') as HTMLElement;
    expect(t.style.opacity).toBe('0.35');

    // Simulate LinkedIn resetting the whole style attribute on re-render.
    t.removeAttribute('style');
    expect(t.style.opacity).toBe('');

    await applyJobTileFilters();
    expect(t.style.opacity).toBe('0.35');
  });

  it('RESTORES a tile fully once its rule is removed', async () => {
    const storage = fakeStorage({ f2a_jt_rules: { companies: ['apex staffing'], keywords: [], labels: {} } });
    installChrome(storage);
    document.body.innerHTML = tile({ jobId: '1', title: 'A', company: 'Apex Staffing' });

    await applyJobTileFilters();
    const t = document.querySelector('[data-occludable-job-id="1"]') as HTMLElement;
    expect(t.style.opacity).toBe('0.35');

    await storage.set({ f2a_jt_rules: { companies: [], keywords: [], labels: {} } });
    await applyJobTileFilters();

    expect(t.style.opacity).toBe('');
    expect(t.querySelector('.f2a-jt-reason')).toBeNull();
  });

  it('fades a tile whose wrapper is display:contents, not the box-less wrapper itself', async () => {
    // Neither committed fixture ships display:contents on a tile (unlike hiringPosts.ts's post
    // cards), but the fade must still land on a rendering descendant if a future markup change adds
    // it — exactly the bug hiringPosts.ts's own boxesOf() was written to fix (0.37.5).
    installChrome(fakeStorage({ f2a_jt_rules: { companies: ['apex staffing'], keywords: [], labels: {} } }));
    document.body.innerHTML = `<div style="display:contents">${tile({
      jobId: '1',
      title: 'A',
      company: 'Apex Staffing',
    })}</div>`;

    await applyJobTileFilters();
    const faded = document.querySelectorAll('[data-f2a-jt-dim]');
    expect(faded.length).toBeGreaterThan(0);
    for (const el of Array.from(faded)) expect((el as HTMLElement).style.opacity).toBe('0.35');
  });

  it('returns null off the job-search page (cheap gate, no DOM work)', async () => {
    setLocation('www.linkedin.com', '/search/results/content/');
    installChrome(fakeStorage({ f2a_jt_rules: { companies: ['apex staffing'], keywords: [], labels: {} } }));
    document.body.innerHTML = tile({ jobId: '1', title: 'A', company: 'Apex Staffing' });

    expect(await applyJobTileFilters()).toBeNull();
    expect((document.querySelector('[data-occludable-job-id="1"]') as HTMLElement).style.opacity).toBe('');
  });
});

describe('the real logged-in tile markup', () => {
  // Regression pin for the layout that actually broke in the field. Everything about it is hostile to
  // class-based selectors: obfuscated rotating class names, no `job-card-container`, no
  // `data-occludable-job-id`, tiles that are not <li>, and no /jobs/view/ anchors. The only stable
  // hooks are the dismiss control's aria-label and the label text itself.
  it('reads a tile the way LinkedIn actually renders it', () => {
    document.body.innerHTML = `
      <div class="_a1b2c3 _d4e5">
        <div class="_f6g7">
          <a href="/jobs/collections/?currentJobId=4414177103"><span>Firmware Engineer</span></a>
          <div><span>Mind Robotics</span></div>
          <div><span>Palo Alto, CA (On-site)</span></div>
          <div><span>Viewed</span><span>·</span><span>Promoted</span></div>
          <button aria-label="Dismiss Firmware Engineer job">X</button>
        </div>
      </div>`;
    const tiles = detectTiles();
    expect(tiles).toHaveLength(1);
    expect(tiles[0].title).toBe('Firmware Engineer');
    expect([...tiles[0].labels].sort()).toEqual(['promoted', 'viewed']);
  });

  it('does not tag a tile whose DESCRIPTION merely contains the word promoted', () => {
    document.body.innerHTML = `
      <div><div>
        <a href="/jobs/collections/?currentJobId=999"><span>Growth Engineer</span></a>
        <div><span>We recently promoted three engineers from this team</span></div>
        <button aria-label="Dismiss Growth Engineer job">X</button>
      </div></div>`;
    const tiles = detectTiles();
    expect(tiles).toHaveLength(1);
    expect(tiles[0].labels.has('promoted')).toBe(false);
  });
});
