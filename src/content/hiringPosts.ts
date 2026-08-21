/**
 * LinkedIn hiring-post filter (passive, live-page only — see JobHakken/JobHakken PR #discussion for
 * why this replaced a desktop-side scrape-and-store design). Runs ONLY on LinkedIn's own post-search
 * results page, which the user reached by browsing there themselves. Nothing is fetched by us and
 * nothing is stored beyond the user's own exclude-tag choices (hiringPostFilterStore.ts) — no post
 * body, no author name, no per-post record. Every button here opens the real LinkedIn page; this
 * module only decorates what's already on the user's screen, the same way h1b.ts decorates job tiles.
 *
 * Selector strategy mirrors h1b.ts's own reasoning: LinkedIn ships hashed atomic class names, so this
 * anchors on the accessibility heading ("Feed post") and aria-labels instead — verified against a real
 * captured search-results page (33 posts; see the JobHakken monorepo's linkedinPosts.ts, which this
 * module is a browser-native port of, not a shared dependency — core no longer ships to this repo).
 */

import { addExcludedTag, loadExcludedTags } from '../lib/hiringPostFilterStore.js';

const PROCESSED_ATTR = 'data-f2a-hp';
const UI_CLASS = 'f2a-hp-ui';

// Chrome/UI strings that show up as leaf text inside a card — not part of the post.
const CHROME = new Set(['feed post', 'follow', 'more', '…', '…more', 'see more', 'like', 'comment', 'repost', 'send']);
// Zero-width space/joiner/non-joiner, LRM/RLM, word joiner, BOM, and soft hyphen — invisible
// characters LinkedIn's markup sometimes leaves inside text nodes. Written as escapes, not literal
// characters, so the source itself never carries the bidi/invisible bytes it's stripping.
const ZERO_WIDTH = /\u200B|\u200C|\u200D|\u200E|\u200F|\u2060|\uFEFF|\u00AD/g;

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
}

/** Is the current tab a LinkedIn post/content search results page? Cheap — checked before any DOM work. */
export function isPostSearchPage(): boolean {
  if (!location.hostname.endsWith('linkedin.com')) return false;
  // Both verticals that actually render posts. Typing a search into LinkedIn's box lands on `all`
  // first — a MIXED page carrying People, Jobs and Company cards next to a Posts section — and only a
  // deliberate click on the Posts tab reaches `content`. Filtering only `content` meant the feature
  // appeared broken for anyone who just searched.
  //
  // Safe on the mixed page because detectPosts() is anchored structurally: it starts from an <h2>
  // reading exactly "Feed post" (LinkedIn's own accessibility heading for a post card), then requires
  // both body text and an author. A People or Jobs card has no such anchor, so it cannot be detected,
  // let alone dimmed. Covered by a mixed-vertical test.
  const p = location.pathname;
  return p.startsWith('/search/results/content') || p.startsWith('/search/results/all');
}

export type DetectedPost = {
  card: HTMLElement;
  authorName: string;
  authorHeadline?: string;
  hiringBadge: boolean;
  body: string;
  jobUrl?: string;
};

function anchorCount(el: Element): number {
  return Array.from(el.querySelectorAll('h2')).filter((h) => clean(h.textContent) === 'Feed post').length;
}

function authorFromAria(card: Element): string {
  const patterns: Array<[string, RegExp]> = [
    ['[aria-label^="Open control menu for post by"]', /^Open control menu for post by\s+(.+?)\s*$/i],
    ['[aria-label^="Follow"]', /^Follow\s+(.+?)\s*$/i],
    ['[aria-label^="View"]', /^View\s+(.+?)[’']s profile/i],
  ];
  for (const [sel, re] of patterns) {
    for (const el of Array.from(card.querySelectorAll(sel))) {
      const m = re.exec(clean(el.getAttribute('aria-label')));
      if (m?.[1]) return m[1].replace(/,\s*hiring$/i, '').trim();
    }
  }
  return '';
}

/**
 * Detect post cards on the current page, not yet processed. Card boundary is structural (climb
 * while the ancestor holds exactly one "Feed post" anchor) — a size-based boundary silently merges
 * two short posts into one; a structural one does not. See the desktop-side port's own test suite for
 * the case that caught this.
 */
export function detectPosts(root: ParentNode = document): DetectedPost[] {
  const anchors = Array.from(root.querySelectorAll('h2')).filter((h) => clean(h.textContent) === 'Feed post');
  const cards = new Map<HTMLElement, true>();
  for (const a of anchors) {
    let n: Element | null = a.parentElement;
    let best: HTMLElement | null = null;
    // Bounded at <body>/<html>: with only one post anywhere in `root` (a narrow search result, or a
    // single-card test fixture), anchorCount(n) never exceeds 1 all the way up, so an unbounded climb
    // would walk past the actual card and land on <html> itself.
    while (n && n !== document.body && n !== document.documentElement) {
      if (anchorCount(n) > 1) break;
      best = n as HTMLElement;
      n = n.parentElement;
    }
    if (best) cards.set(best, true);
  }

  const out: DetectedPost[] = [];
  for (const card of cards.keys()) {
    // Deliberately NOT skipping cards we've already processed. LinkedIn re-renders constantly and
    // resets the `style` attribute, which wipes the dim while leaving our appended note behind — the
    // reported symptom was a post reading 'Hidden — matches "senior"' at full brightness. Keying
    // idempotency on a one-time flag means we can never repair that; re-evaluating every pass makes the
    // dim self-healing. Repeat work is cheap: `stateByKey` short-circuits before any AI call, `dim()`
    // updates the existing note rather than stacking, and the row is guarded on already being present.

    const body = clean(
      Array.from(card.querySelectorAll('p'))
        .map((p) => clean(p.textContent))
        .filter((t) => t && !CHROME.has(t.toLowerCase()))
        .join(' '),
    ).replace(/\s*…\s*more\s*$/i, '');
    if (!body) continue;

    const authorName = authorFromAria(card);
    if (!authorName) continue;

    const hiringBadge = Array.from(card.querySelectorAll('[aria-label]')).some((el) => {
      const l = clean(el.getAttribute('aria-label'));
      return /,\s*hiring\b/i.test(l) || /hiring premium profile/i.test(l);
    });

    // Same job-card extraction as the desktop port: first /jobs/view/ href, tracking params stripped.
    const jobLink = Array.from(card.querySelectorAll('a')).find((a) =>
      /\/jobs\/view\//.test(a.getAttribute('href') ?? ''),
    );
    const rawJobHref = jobLink?.getAttribute('href') ?? '';
    const jobUrl = rawJobHref
      ? (rawJobHref.startsWith('http') ? rawJobHref : `https://www.linkedin.com${rawJobHref}`).split('?')[0]
      : undefined;

    const leaves = Array.from(card.querySelectorAll('span,div'))
      .filter((e) => e.children.length === 0)
      .map((e) => clean(e.textContent))
      .filter(Boolean);
    const authorHeadline = leaves
      .filter(
        (t) =>
          t.length > 8 &&
          t.length <= 120 &&
          !CHROME.has(t.toLowerCase()) &&
          !/^\d+$/.test(t) &&
          t !== authorName &&
          !t.startsWith('#') &&
          !body.startsWith(t),
      )
      .sort((a, b) => b.length - a.length)[0];

    out.push({ card, authorName, authorHeadline, hiringBadge, body, jobUrl });
  }
  return out;
}

/**
 * Is this post someone HIRING, not someone looking for work? Same patterns as the desktop port's
 * isLikelyHiringPost — the dominant noise on `hiring "X"` is job seekers ("#OpenToWork…"), who match
 * every keyword this search uses, so a seeker signal vetoes even a badged profile.
 */
export function isLikelyHiringPost(post: Pick<DetectedPost, 'body' | 'hiringBadge'>): boolean {
  // Fold typographic punctuation to ASCII FIRST. LinkedIn renders "We’re hiring" with a curly
  // apostrophe (U+2019), so every pattern written with a straight one silently failed against the real
  // site — verified on a live post-search: "**FILLED** We’re hiring: Firmware Engineers (6 openings!)"
  // was labelled "looks like someone looking for work". Tests used straight quotes and passed happily,
  // which is exactly how this survived.
  const norm = (s: string) => s.replace(/[‘’ʼ′]/g, "'").replace(/[“”]/g, '"');
  const body = norm(post.body);
  const b = body.toLowerCase();
  // An UNAMBIGUOUS hiring statement wins over a seeker phrase, and is therefore checked first.
  // Recruiters routinely tag their own hiring posts #OpenToWork to reach seekers, so the veto below was
  // firing on the hashtag block of posts that plainly said "#hiring for #Embedded_Security_Engineer".
  // Measured against a real saved post-search: 8 of 78 posts were rejected for exactly that reason.
  //
  // Each alternative here has to be something a job SEEKER would not write about themselves — "hiring:",
  // "hiring alert", "N openings". Deliberately NOT a bare "hiring", which appears in half the recruiter
  // headlines on this search ("Hiring-Manager Outreach", "Technology Hiring @ X") and would match a
  // career-coach's bio.
  const strongHiring =
    /\bhiring\s*[:!]|\bhiring alert\b|#hiring\b|\b(hiring|recruiting) for\b|\bwe(?:'| a)?re hiring\b|\bi(?:'| a)?m hiring\b|\bhiring (multiple|several|\d+)\b|\b\d+\s+openings?\b|\bmultiple openings?\b|\bopenings? for\b/i.test(
      body,
    );
  if (strongHiring) return true;

  const seeker =
    /\b(open to work|opentowork|looking for (a |my )?(new )?(role|job|opportunit|position)|seeking (a )?(new )?(role|job|opportunit|position)|i was (laid off|impacted)|my last day|available immediately for)\b/.test(
      b,
    );
  if (seeker) return false;
  if (post.hiringBadge) return true;
  // A bare "Hiring:" / "#hiring" / "We're hiring" opener is the single most common way these posts are
  // written, and the earlier pattern list missed all of the bare forms — it only matched "hiring" when
  // glued to another word ("is hiring", "now hiring"). So a post opening "Hiring: Firmware QA Engineer,
  // $85,000" was classed as a JOB SEEKER and dimmed with "looks like someone looking for work", which is
  // both wrong and the exact opposite of what it says. Verified against a real LinkedIn post-search.
  if (/(^|\n)\s*#?hiring\b\s*[:\-–—!]?/i.test(body)) return true;
  if (/\b(hiring|recruiting) for\b|\bwe(?:'| a)?re hiring\b|\b#hiring\b/i.test(body)) return true;
  return /\b(we(?:'| a)?re hiring|hiring now|is hiring|now hiring|join (our|the) team|open (role|position|headcount)|we have an opening|apply (here|now|via)|dm me if|send (me )?your (cv|resume)|referrals? welcome)\b/.test(
    b,
  );
}

/** Best-effort link to relocate this specific post — no permalink exists on this page (verified: zero
 *  urn:li:activity occurrences anywhere), so this quotes the post's own longest sentence back at
 *  LinkedIn's relevance-sorted content search. Can occasionally miss; see the desktop port for detail. */
export function buildFindPostUrl(body: string): string {
  const cleaned = body.replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('buildFindPostUrl: body is required');
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const longest = sentences.reduce((a, b) => (b.length > a.length ? b : a), sentences[0] ?? cleaned);
  const excerpt = longest.trim().split(' ').slice(0, 14).join(' ');
  const keywords = encodeURIComponent(`"${excerpt}"`);
  return `https://www.linkedin.com/search/results/content/?keywords=${keywords}&origin=SWITCH_SEARCH_VERTICAL`;
}

/** Content-based identity for a post — no permalink exists on this page, so identity has to come
 *  from what's in it. Used only as an in-memory session key (never persisted) to avoid double-tagging
 *  the same post if a React re-render replaces its DOM node mid-flight. */
function dedupeKey(post: Pick<DetectedPost, 'authorName' | 'body'>): string {
  return `${post.authorName.toLowerCase().trim()}::${post.body.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120)}`;
}

type PostState = { status: 'pending' | 'done'; tags: string[] };
// In-memory only, cleared on page reload — never chrome.storage. Session-scoped classification cache.
const stateByKey = new Map<string, PostState>();

function styleBlock(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, String(v), 'important');
}

/** A tag chip. Click toggles it into the persisted exclude list and dims this card immediately —
 *  no waiting for a re-scan, the whole point is instant feedback on a choice the user just made. */
function tagChip(tag: string, card: HTMLElement, onExclude: (tag: string) => void): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.textContent = tag;
  chip.title = `Hide posts like this (and future posts tagged "${tag}") going forward`;
  styleBlock(chip, {
    font: '600 11px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    padding: '2px 9px',
    borderRadius: '999px',
    border: '1px solid #d0d5dd',
    background: '#f2f4f7',
    color: '#344054',
    cursor: 'pointer',
  });
  chip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onExclude(tag);
    dim(card, `Hidden — matches "${tag}", which you just chose to filter`);
  });
  return chip;
}

/** Dim a card in place and label why. Never removes it — it's the user's own browser showing their
 *  own search results; this only de-emphasizes, the same restraint h1b.ts uses for badges. */
function dim(card: HTMLElement, reason: string): void {
  styleBlock(card, { opacity: '0.35' });
  const existing = card.querySelector(`.${UI_CLASS}-reason`);
  if (existing) {
    existing.textContent = reason;
    return;
  }
  const note = document.createElement('div');
  note.className = `${UI_CLASS}-reason`;
  note.textContent = reason;
  styleBlock(note, {
    font: '600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    color: '#98a2b3',
    padding: '4px 0',
  });
  card.appendChild(note);
}

/** Undo `dim`. Removing a rule has to visibly give the post back, or the rail's remove button looks
 *  broken: the re-run stops MATCHING the card but nothing ever restored its opacity. */
function undim(card: HTMLElement): void {
  styleBlock(card, { opacity: '1' });
  card.querySelector(`.${UI_CLASS}-reason`)?.remove();
}

function renderRow(post: DetectedPost, tags: string[], onExclude: (tag: string) => void): HTMLElement {
  const row = document.createElement('div');
  row.className = UI_CLASS;
  styleBlock(row, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', padding: '8px 0 4px' });

  // No "View job" / "Find this post" links: LinkedIn already puts its own job card on the post, so ours
  // duplicated a button sitting inches away, and "Find this post" was a best-effort text search that
  // could land on the wrong post. The row is the filtering controls now — the thing only we provide.
  for (const tag of tags) row.appendChild(tagChip(tag, post.card, onExclude));
  return row;
}

/** Chrome runtime message contract with the background service worker's AI tag suggester. Returns
 *  [] on any failure (no key configured, offline, model error) — tag suggestion is a bonus, not a
 *  requirement; the two link buttons above work with no AI involved at all. */
async function suggestTags(post: DetectedPost): Promise<string[]> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'f2a-hp-tags',
      body: post.body,
      headline: post.authorHeadline ?? '',
    })) as { tags?: string[] } | undefined;
    return Array.isArray(res?.tags) ? res!.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 4) : [];
  } catch {
    return [];
  }
}

/**
 * Run one pass over the current page. Cheap URL gate first (see isPostSearchPage) — this must be
 * checked before any DOM work, the same discipline content.ts already applies to its own
 * mutation-observer callback, because that callback fires on every page the user has open.
 */
export async function applyHiringPostFilters(): Promise<void> {
  if (!isPostSearchPage()) return;

  const excluded = await loadExcludedTags();
  const posts = detectPosts();

  for (const post of posts) {
    post.card.setAttribute(PROCESSED_ATTR, '1');
    const key = dedupeKey(post);

    if (!isLikelyHiringPost(post)) {
      dim(post.card, 'Not a hiring post — looks like someone looking for work, not offering a role');
      continue;
    }

    const already = stateByKey.get(key);
    if (already?.status === 'done') {
      const matched = already.tags.find((t) => excluded.includes(t));
      if (matched) dim(post.card, `Hidden — matches "${matched}"`);
      else {
        undim(post.card); // a rule was removed (or never matched) — give the post back
        if (already.tags.length && !post.card.querySelector(`.${UI_CLASS}`))
          post.card.appendChild(renderRow(post, already.tags, onExclude));
      }
      continue;
    }
    if (already?.status === 'pending') continue; // an AI call for this post is already in flight

    // Cheap local check BEFORE spending an AI call: does the body already mention a tag the user
    // has committed to excluding? If so, no need to ask the model anything about this post at all.
    const preMatch = excluded.find(
      (t) => post.body.toLowerCase().includes(t) || (post.authorHeadline ?? '').toLowerCase().includes(t),
    );
    if (preMatch) {
      stateByKey.set(key, { status: 'done', tags: [preMatch] });
      dim(post.card, `Hidden — matches "${preMatch}"`);
      continue;
    }

    stateByKey.set(key, { status: 'pending', tags: [] });
    void suggestTags(post).then((tags) => {
      stateByKey.set(key, { status: 'done', tags });
      // The card may have been wiped by a React re-render while the AI call was in flight — only
      // inject if it's still the one attached to the live document.
      if (document.contains(post.card) && !post.card.querySelector(`.${UI_CLASS}`)) {
        if (tags.length) post.card.appendChild(renderRow(post, tags, onExclude));
      }
    });
  }
}

async function onExclude(tag: string): Promise<void> {
  await addExcludedTag(tag.toLowerCase().trim());
}
