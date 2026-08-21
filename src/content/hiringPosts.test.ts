/**
 * @jest-environment jsdom
 *
 * LinkedIn hiring-post filter (passive, live-page only). Fixtures mirror a REAL captured LinkedIn
 * content-search page's structure — hashed atomic classes, GUID componentkeys, no semantic classes,
 * an <h2>Feed post</h2> accessibility anchor per card, author name only in aria-labels, body text in
 * <p>s, no post permalink anywhere. Identities are placeholders (Jordan Rivera / example.com).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  applyHiringPostFilters,
  buildFindPostUrl,
  detectPosts,
  includeFilterStatus,
  isHiringSearch,
  isLikelyHiringPost,
  isPostSearchPage,
} from './hiringPosts';

// Defaults to a hiring-flavoured query (`?keywords=hiring`) so every EXISTING call site in this file —
// written before #189 — keeps testing what it always tested: a hiring search. Tests for #189's
// non-hiring-search behaviour pass an explicit non-hiring `search` string.
function setLocation(hostname: string, pathname: string, search = '?keywords=hiring'): void {
  Object.defineProperty(window, 'location', {
    value: { hostname, pathname, href: `https://${hostname}${pathname}${search}` },
    writable: true,
  });
}

/** A chrome.storage.local fake that actually holds state across get/set, like the real thing. */
function fakeStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: jest.fn(async (key: string) => ({ [key]: data[key] })),
    set: jest.fn(async (obj: Record<string, unknown>) => Object.assign(data, obj)),
    remove: jest.fn(async (key: string) => delete data[key]),
  };
}

function installChrome(
  opts: { tags?: string[]; sendMessage?: jest.Mock; storage?: ReturnType<typeof fakeStorage> } = {},
) {
  const sendMessage = opts.sendMessage ?? (jest.fn(async () => ({ tags: opts.tags ?? [] })) as unknown as jest.Mock);
  const storage = opts.storage ?? fakeStorage();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage, id: 'test-ext-id' },
    storage: { local: storage },
  };
  return { sendMessage, storage };
}

/**
 * Shaped like the REAL captured markup (#182), not just a plausible guess: LinkedIn puts the author's
 * name, connection degree, headline AND post timestamp each in their own `<p>`, ahead of the post's
 * own `<p>`s — verified against a real 78-post capture, where a card's own text always starts
 * immediately after its "Open control menu for post by X" button, in this exact relative order:
 * avatar/name/degree, headline, timestamp, Follow button, control-menu button, THEN the post's `<p>`s.
 */
function card(opts: {
  name: string;
  body: string;
  hiring?: boolean;
  profile?: string;
  jobId?: string;
  headline?: string;
  mention?: string; // an @-mention of someone ELSE inside the post's own body (regression case)
}): string {
  const {
    name,
    body,
    hiring = false,
    profile = '/in/jordan-rivera-000',
    jobId,
    headline = 'Engineering Manager',
  } = opts;
  const jobCard = jobId ? `<div><a href="/jobs/view/${jobId}/?trackingId=abc"><span>View job</span></a></div>` : '';
  const mention = opts.mention
    ? `<a href="/in/other"><span aria-label="View ${opts.mention}'s profile"></span>${opts.mention}</a>`
    : '';
  return `
  <div class="_94b267c9" componentkey="auto-component-1">
    <h2><span>Feed post</span></h2>
    <div>
      <a href="${profile}?miniProfileUrn=abc">
        <svg role="img" aria-label="View ${name}'s profile${hiring ? ', hiring' : ''}"></svg>
        <div aria-label="${name} ${hiring ? 'Hiring ' : ''}Premium Profile 3rd+">
          <div><p><span>${name}</span></p></div>
          <div><p><span>• 3rd+</span></p></div>
        </div>
      </a>
      <div><p><span>${headline}</span></p></div>
      <div><p><span>2w •</span></p></div>
      <button aria-label="Follow ${name}"><span>Follow</span></button>
      <button aria-label="Open control menu for post by ${name}"></button>
    </div>
    <div>${body
      .split('\n')
      .map((line) => `<p>${line}</p>`)
      .join('')}${mention}<span>…</span><span>more</span></div>
    ${jobCard}
  </div>`;
}

const HIRING_BODY = 'We are hiring a firmware engineer for secure boot work. Apply here.';
const SEEKER_BODY = '#OpenToWork looking for a new firmware role after being impacted by layoffs.';

describe('isPostSearchPage', () => {
  it('is true on the LinkedIn content-search results page', () => {
    setLocation('www.linkedin.com', '/search/results/content/');
    expect(isPostSearchPage()).toBe(true);
  });

  it('is true on the mixed "all" vertical — where a typed search actually lands', () => {
    setLocation('www.linkedin.com', '/search/results/all/');
    expect(isPostSearchPage()).toBe(true);
  });

  it('is false on a LinkedIn jobs page — a different vertical', () => {
    setLocation('www.linkedin.com', '/jobs/search-results/');
    expect(isPostSearchPage()).toBe(false);
  });

  it('is false on a non-LinkedIn page', () => {
    setLocation('www.indeed.com', '/search/results/content/');
    expect(isPostSearchPage()).toBe(false);
  });

  // #189 acceptance criterion: this feature must never run on the home feed — an infinite feed makes
  // "tag every post" unbounded cost/privacy, and a general feed cleaner is arguably a second product
  // under the Chrome Web Store's single-purpose policy (see the issue). Pinned explicitly since nothing
  // else in the suite exercises a feed URL.
  it('is false on the home feed', () => {
    setLocation('www.linkedin.com', '/feed/');
    expect(isPostSearchPage()).toBe(false);
  });
});

// #189: the query itself is the signal for whether the automatic hiring-post fade should run at all —
// checked against the `keywords` search param, never against any individual post's text.
describe('isHiringSearch', () => {
  it('is true for the obvious cases', () => {
    for (const q of ['hiring', 'we%27re%20hiring%20firmware', '%23hiring', 'embedded%20recruiter']) {
      setLocation('www.linkedin.com', '/search/results/content/', `?keywords=${q}`);
      expect(isHiringSearch()).toBe(true);
    }
  });

  it('is true for role/hiring-domain vocabulary beyond the literal word "hiring"', () => {
    for (const q of ['open%20positions', 'headcount', 'talent%20acquisition', 'job%20openings']) {
      setLocation('www.linkedin.com', '/search/results/content/', `?keywords=${q}`);
      expect(isHiringSearch()).toBe(true);
    }
  });

  it('is false for an unrelated content search', () => {
    for (const q of ['microsoft', 'AI%20trends', 'layoffs', 'remote%20work%20culture']) {
      setLocation('www.linkedin.com', '/search/results/content/', `?keywords=${q}`);
      expect(isHiringSearch()).toBe(false);
    }
  });

  it('is false with no keywords param at all', () => {
    setLocation('www.linkedin.com', '/search/results/content/', '');
    expect(isHiringSearch()).toBe(false);
  });
});

describe('detectPosts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts author, headline, hiring badge, body, and jobUrl from a real-shaped card', () => {
    document.body.innerHTML = card({ name: 'Jordan Rivera', body: HIRING_BODY, hiring: true, jobId: '4443875906' });
    const posts = detectPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].authorName).toBe('Jordan Rivera');
    expect(posts[0].authorHeadline).toBe('Engineering Manager');
    expect(posts[0].hiringBadge).toBe(true);
    expect(posts[0].body).toContain('secure boot');
    expect(posts[0].jobUrl).toBe('https://www.linkedin.com/jobs/view/4443875906/');
  });

  // #182: LinkedIn puts the author's name, connection degree, headline and post age in their own
  // <p>s ahead of the post's own text, so a blind `querySelectorAll('p')` produced a body reading
  // "Simran Jiwani • 3rd+ Lead Recruiter at Motive Workforce 4w • Hiring: Firmware QA Engineer …" on
  // a real captured post — the author's name and headline BEFORE the post's own first word. Confirmed
  // by running detectPosts() against a saved 78-post capture.
  it('scopes body to the post’s own text — the author’s name/degree/headline/timestamp never appear in it', () => {
    document.body.innerHTML = card({
      name: 'Simran Jiwani',
      headline: 'Lead Recruiter at Motive Workforce',
      body: 'Hiring: Firmware QA Engineer (Embedded Test Engineer)\nWestlake Village, CA (100% Onsite)',
    });
    const posts = detectPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].body.startsWith('Hiring: Firmware QA Engineer')).toBe(true);
    expect(posts[0].body).not.toContain('Simran Jiwani');
    expect(posts[0].body).not.toContain('Lead Recruiter at Motive Workforce');
    expect(posts[0].body).not.toContain('3rd+');
    expect(posts[0].body).not.toContain('2w •');
    // The real headline is still captured separately (still sent to the AI as `headline`, per issue's
    // own scope) — #182 is about it not ALSO leaking into `body`, not about hiding it altogether.
    expect(posts[0].authorHeadline).toBe('Lead Recruiter at Motive Workforce');
  });

  // Regression for a real bug this fix could have introduced: a post that itself @-mentions someone
  // ELSE renders that mention with the identical "View {name}'s profile" aria-label shape the header
  // boundary looks for. An unscoped "latest match wins" search real-world-broke on exactly this (a KLA
  // hiring post tagging four colleagues at the end) — it pushed the boundary past the post's own
  // paragraph entirely, leaving body empty and silently dropping the post from the 78-post capture.
  it('does not let an @-mention of someone else inside the post push the header boundary past the post’s own text', () => {
    document.body.innerHTML = card({
      name: 'Dana Okafor',
      body: 'We are hiring a firmware engineer. Great team led by',
      mention: 'Alex Chen',
    });
    const posts = detectPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toContain('We are hiring a firmware engineer');
  });

  it('does not merge two short posts into one — the card boundary is structural, not size-based', () => {
    document.body.innerHTML =
      card({ name: 'Jordan Rivera', body: 'Hiring now.', profile: '/in/jordan-rivera-000' }) +
      card({ name: 'Alex Chen', body: 'We are hiring an RTOS engineer.', profile: '/in/alex-chen-111' });
    const posts = detectPosts();
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.authorName).sort()).toEqual(['Alex Chen', 'Jordan Rivera']);
  });

  it('RE-EVALUATES a card it already processed, so a wiped dim can be repaired', () => {
    // LinkedIn resets the `style` attribute on re-render, which wipes the dim while leaving our note
    // behind — a post reading 'Hidden — matches "senior"' at full brightness. Skipping processed cards
    // made that unrepairable, so detection deliberately returns them again.
    document.body.innerHTML = card({ name: 'Jordan Rivera', body: HIRING_BODY });
    const el = document.querySelector('[componentkey]') as HTMLElement;
    el.setAttribute('data-f2a-hp', '1');
    expect(detectPosts()).toHaveLength(1);
  });
});

describe('detectPosts on the mixed "all" vertical', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // The `all` results page puts People/Jobs/Company cards next to posts. Those carry names, headlines
  // and links just like a post does, so the ONLY thing keeping us off them is the structural "Feed
  // post" anchor. If that ever stops holding, we would dim a stranger's People card — visible damage on
  // a page nobody asked us to touch. Pin it.
  it('detects only the post, never the People/Jobs/Company cards beside it', () => {
    document.body.innerHTML = `
      <section>
        <h2><span>People</span></h2>
        <div aria-label="Simran Jiwani, 3rd+"><a href="/in/simran"><span>Simran Jiwani</span></a>
          <p>Lead Recruiter at Motive Workforce — hiring firmware engineers</p></div>
      </section>
      <section>
        <h2><span>Jobs</span></h2>
        <div aria-label="Firmware QA Engineer"><a href="/jobs/view/999/"><span>Firmware QA Engineer</span></a>
          <p>We are hiring a firmware engineer, apply now</p></div>
      </section>
      <section>${card({ name: 'Thomas Anderson', body: HIRING_BODY, hiring: true })}</section>`;

    const posts = detectPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].authorName).toBe('Thomas Anderson');
  });
});

describe('isLikelyHiringPost', () => {
  it('keeps a genuine hiring post', () => {
    expect(
      isLikelyHiringPost({ body: 'we are hiring a firmware engineer, dm me if interested', hiringBadge: false }),
    ).toBe(true);
  });

  it('keeps "We\u2019re hiring" written with LinkedIn\u2019s curly apostrophe', () => {
    // The real site renders U+2019, not '. Every pattern written with a straight apostrophe missed it,
    // and the tests missed the miss because they were written with straight quotes too.
    const body =
      '**FILLED** \u{1F527} We\u2019re hiring: Firmware Engineers (6 openings!)\nCarlsbad, CA, 8-month contract';
    expect(isLikelyHiringPost({ body, hiringBadge: false })).toBe(true);
  });

  it('keeps a bare "Hiring:" opener — the most common form, and previously dimmed as a seeker', () => {
    // Real post from a LinkedIn post-search that this used to mislabel "someone looking for work".
    const body =
      'Hiring: Firmware QA Engineer (Embedded Test Engineer)\nWestlake Village, CA (100% Onsite)\n$85,000 + Benefits';
    expect(isLikelyHiringPost({ body, hiringBadge: false })).toBe(true);
    expect(isLikelyHiringPost({ body: '#hiring firmware engineers in Austin', hiringBadge: false })).toBe(true);
  });

  it('still lets a seeker signal veto a "hiring" mention', () => {
    expect(
      isLikelyHiringPost({ body: 'Hiring managers: I am open to work and looking for a role', hiringBadge: false }),
    ).toBe(false);
  });

  // All five bodies below are taken from a real saved LinkedIn post-search (78 posts). Before these
  // patterns existed, 37 of those 78 were rejected; afterwards 10 (with the pre-#182 body, which also
  // carried the author's name/headline). After #182 scoped `body` to the post's own text, 9 remain
  // rejected and are genuinely not hiring posts — the 10th ("Hiring Embedded software engineers for
  // Amazon…") was a false negative caused by header pollution burying its own "Hiring" opener behind
  // unrelated name/headline text, and is now correctly recognised once the body is clean.
  it('keeps a recruiter post that merely TAGS #OpenToWork to reach seekers', () => {
    const body = '#hiring for #Embedded_Security_Engineer 10+ Location: San Jose, CA (Remote) #OpenToWork #C2C';
    expect(isLikelyHiringPost({ body, hiringBadge: false })).toBe(true);
  });

  it('keeps "Hiring Alert" and emoji-prefixed "Hiring:" openers', () => {
    expect(
      isLikelyHiringPost({
        body: '\u{1F4A5} Hiring Alert \u{1F4A5} We are looking for Embedded Firmware engineers',
        hiringBadge: false,
      }),
    ).toBe(true);
    expect(
      isLikelyHiringPost({
        body: '\u{1F680} Hiring: Wi-Fi Embedded C Developers (5 Openings) Englewood, CO',
        hiringBadge: false,
      }),
    ).toBe(true);
  });

  it('still rejects career-coach and commentary posts that merely say the word hiring', () => {
    // A bare "hiring" is deliberately NOT a signal: it is in half the recruiter headlines on this search.
    expect(
      isLikelyHiringPost({
        body: 'Veteran Career Coach | Recruiter-Ready Resumes | Hiring-Manager Outreach. Meet the hiring managers.',
        hiringBadge: false,
      }),
    ).toBe(false);
    expect(
      isLikelyHiringPost({
        body: 'Unpopular opinion: the biggest reason companies are losing embedded and firmware engineers is pay.',
        hiringBadge: false,
      }),
    ).toBe(false);
  });

  it('keeps a formal job description on the strength of its attached job card', () => {
    // A real OpenAI firmware role was faded as "looks like someone looking for work": a formal JD lists
    // responsibilities and requirements and often never says "we're hiring" anywhere. The attached job
    // listing is the signal — LinkedIn only renders that card when the author attached a real posting,
    // and nobody advertising their own availability attaches one.
    const body =
      'Bring up and debug new boards. Analyze performance, memory, and power profiles. ' +
      'You Might Thrive In This Role If You Have deep experience shipping embedded systems.';
    expect(isLikelyHiringPost({ body, hiringBadge: false, jobUrl: undefined })).toBe(false);
    expect(isLikelyHiringPost({ body, hiringBadge: false, jobUrl: '/jobs/view/4414177103/' })).toBe(true);
  });

  it('still rejects a job seeker even if a job card is absent', () => {
    expect(isLikelyHiringPost({ body: SEEKER_BODY, hiringBadge: false, jobUrl: undefined })).toBe(false);
  });

  it('rejects job seekers — the dominant noise in this search', () => {
    for (const body of [
      '#OpenToWork looking for a new firmware role after being impacted by layoffs',
      'I am seeking a new opportunity in embedded systems, referrals appreciated',
    ]) {
      expect(isLikelyHiringPost({ body, hiringBadge: false })).toBe(false);
    }
  });

  it('lets a seeker signal veto even when the badge is present', () => {
    expect(isLikelyHiringPost({ body: 'open to work — looking for a role in firmware', hiringBadge: true })).toBe(
      false,
    );
  });

  it('accepts the badge as sufficient when the body has no explicit hiring phrasing', () => {
    expect(
      isLikelyHiringPost({ body: 'Great things happening on our embedded platform team.', hiringBadge: true }),
    ).toBe(true);
  });
});

describe('buildFindPostUrl', () => {
  it('targets the content vertical, relevance-sorted (no sortBy) — a lookup, not a feed', () => {
    const url = buildFindPostUrl(HIRING_BODY);
    expect(url).toContain('/search/results/content/');
    expect(url).toContain('origin=SWITCH_SEARCH_VERTICAL');
    expect(url).not.toContain('sortBy');
  });

  it('rejects empty input', () => {
    expect(() => buildFindPostUrl('   ')).toThrow();
  });
});

describe('applyHiringPostFilters', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does nothing off the post-search page — no DOM work, no chrome calls', async () => {
    setLocation('www.linkedin.com', '/jobs/search-results/');
    const { sendMessage } = installChrome();
    document.body.innerHTML = card({ name: 'Jordan Rivera', body: HIRING_BODY });

    await applyHiringPostFilters();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(document.querySelector('.f2a-hp-ui')).toBeNull();
  });

  it('dims a seeker post deterministically — no AI call spent on it', async () => {
    setLocation('www.linkedin.com', '/search/results/content/'); // default keywords=hiring
    const { sendMessage } = installChrome();
    document.body.innerHTML = card({ name: 'Alex Chen', body: SEEKER_BODY });

    await applyHiringPostFilters();

    expect(sendMessage).not.toHaveBeenCalled();
    const cardEl = document.querySelector('div[componentkey]') as HTMLElement;
    expect(cardEl.style.opacity).toBe('0.35');
    expect(cardEl.textContent).toContain('Not a hiring post');
  });

  // #189: on a NON-hiring content search, the automatic "not a hiring post" fade must not run at all —
  // only the person's own exclude/include rules do. Reusing SEEKER_BODY (which would be dimmed
  // automatically on a hiring search, per the test above) isolates exactly this behaviour.
  it('does not auto-fade anything on a non-hiring content search — only the person’s own rules apply', async () => {
    setLocation('www.linkedin.com', '/search/results/content/', '?keywords=microsoft%20layoffs');
    const { sendMessage } = installChrome();
    document.body.innerHTML = card({ name: 'Priya Nair', body: SEEKER_BODY });

    await applyHiringPostFilters();
    await new Promise((r) => setTimeout(r, 0));

    const cardEl = document.querySelector('div[componentkey]') as HTMLElement;
    expect(cardEl.style.opacity).toBe(''); // not dimmed — no automatic judgment on a non-hiring search
    expect(cardEl.textContent).not.toContain('Not a hiring post');
    // The general exclude-tag machinery is untouched by the query — the AI is still asked for tags so
    // the person's own rules have something to match against.
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'f2a-hp-tags' }));
  });

  it('still hides a post matching the person’s own exclude rule on a non-hiring search', async () => {
    setLocation('www.linkedin.com', '/search/results/content/', '?keywords=microsoft');
    const { sendMessage } = installChrome({
      storage: fakeStorage({ f2a_hp_excluded_tags: ['layoffs'] }),
    });
    document.body.innerHTML = card({ name: 'Jamie Lee', body: 'Sharing my thoughts on the recent layoffs news.' });

    await applyHiringPostFilters();

    expect(sendMessage).not.toHaveBeenCalled(); // matched the excluded tag locally
    const cardEl = document.querySelector('div[componentkey]') as HTMLElement;
    expect(cardEl.style.opacity).toBe('0.35');
    expect(cardEl.textContent).toContain('layoffs');
  });

  it('asks the service worker for tags on a real hiring post, and renders the tag chips', async () => {
    setLocation('www.linkedin.com', '/search/results/content/');
    const { sendMessage } = installChrome({ tags: ['recruiter agency'] });
    document.body.innerHTML = card({ name: 'Jordan Rivera', body: HIRING_BODY, jobId: '999' });

    await applyHiringPostFilters();
    await new Promise((r) => setTimeout(r, 0)); // let the pending suggestTags().then(...) settle

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'f2a-hp-tags' }));
    const row = document.querySelector('.f2a-hp-ui');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('recruiter agency');
    // The two link buttons were removed deliberately: LinkedIn already renders its own job card on the
    // post, so ours duplicated a button inches away, and "Find this post" was a best-effort text search
    // that could land on the wrong post. Pin their absence so they don't creep back.
    expect(row?.textContent).not.toContain('View job');
    expect(row?.textContent).not.toContain('Find this post');
  });

  it('adds no row at all when there are no tags to offer', async () => {
    setLocation('www.linkedin.com', '/search/results/content/');
    installChrome({ tags: [] });
    // A DISTINCT body: the per-post cache is module-level and keyed on the post, so reusing
    // HIRING_BODY here would hit the tags an earlier test already cached for it.
    document.body.innerHTML = card({
      name: 'Dana Okafor',
      body: 'Hiring: Embedded Linux Engineer in Austin. Apply via the link.',
      jobId: '888',
    });

    await applyHiringPostFilters();
    await new Promise((r) => setTimeout(r, 0));

    // With the links gone, a tagless post would otherwise get an empty strip under it.
    expect(document.querySelector('.f2a-hp-ui')).toBeNull();
  });

  it('fades a card whose wrapper is display:contents (LinkedIn\u2019s real shape)', async () => {
    setLocation('www.linkedin.com', '/search/results/content/');
    // Seed the EXCLUDE list in storage; installChrome's `tags` is the AI response, not the rule list.
    installChrome({ storage: fakeStorage({ f2a_hp_excluded_tags: ['dimtest'] }) });
    // LinkedIn wraps every post in a display:contents element. Such an element generates NO BOX, so
    // `opacity` on it is ignored by the spec and the post stayed at full brightness while still being
    // labelled "Hidden — matches …". Verified against a real capture: every detected card reported
    // display:contents with height 0. The fade must land on a descendant that actually renders.
    // A DISTINCT body: the per-post cache is module-level, so reusing HIRING_BODY would hit state an
    // earlier test cached for it and take the undim branch instead.
    const body = 'Hiring: Embedded firmware engineer at Zephyr Labs. dimtest marker. Apply here.';
    document.body.innerHTML = `<div style="display:contents">${card({ name: 'Dana Okafor', body })}</div>`;

    await applyHiringPostFilters();
    await new Promise((r) => setTimeout(r, 0));

    // Something inside the card must carry the fade — not merely the box-less wrapper.
    const faded = document.querySelectorAll('[data-f2a-hp-dim]');
    expect(faded.length).toBeGreaterThan(0);
    for (const el of faded) expect((el as HTMLElement).style.opacity).toBe('0.35');
  });

  it('clicking a tag chip dims the card AND persists the tag for future posts', async () => {
    setLocation('www.linkedin.com', '/search/results/content/');
    const { storage } = installChrome({ tags: ['recruiter agency'] });
    document.body.innerHTML = card({ name: 'Jordan Rivera', body: HIRING_BODY });

    await applyHiringPostFilters();
    await new Promise((r) => setTimeout(r, 0));

    const chip = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'recruiter agency');
    expect(chip).toBeDefined();
    chip!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const cardEl = document.querySelector('div[componentkey]') as HTMLElement;
    expect(cardEl.style.opacity).toBe('0.35');
    expect(storage.set).toHaveBeenCalledWith({ f2a_hp_excluded_tags: ['recruiter agency'] });
  });

  it('a NEW post matching an already-excluded tag is dimmed WITHOUT spending another AI call', async () => {
    setLocation('www.linkedin.com', '/search/results/content/');
    const { sendMessage } = installChrome({
      storage: fakeStorage({ f2a_hp_excluded_tags: ['recruiter agency'] }),
    });
    document.body.innerHTML = card({
      name: 'Priya Nair',
      body: 'We are hiring! Recruiter agency reaching out on behalf of our client. Apply now.',
    });

    await applyHiringPostFilters();

    expect(sendMessage).not.toHaveBeenCalled(); // matched the excluded tag locally — never asked the SW
    const cardEl = document.querySelector('div[componentkey]') as HTMLElement;
    expect(cardEl.style.opacity).toBe('0.35');
    expect(cardEl.textContent).toContain('recruiter agency');
  });

  // #186: "only show posts matching" — a separate, independent list from the exclude rules above.
  describe('the "only show posts matching" include list', () => {
    it('dims a post matching NONE of the include terms', async () => {
      setLocation('www.linkedin.com', '/search/results/content/');
      installChrome({ storage: fakeStorage({ f2a_hp_include_terms: ['zephyr'] }) });
      document.body.innerHTML = card({ name: 'Alex Chen', body: HIRING_BODY }); // no "zephyr" anywhere

      await applyHiringPostFilters();

      const cardEl = document.querySelector('div[componentkey]') as HTMLElement;
      expect(cardEl.style.opacity).toBe('0.35');
      expect(cardEl.textContent).toContain('only show');
    });

    it('leaves a matching post alone — checked BEFORE the hiring-relevance fade and exclude matching', async () => {
      setLocation('www.linkedin.com', '/search/results/content/');
      const { sendMessage } = installChrome({
        tags: ['recruiter agency'],
        storage: fakeStorage({ f2a_hp_include_terms: ['zephyr'] }),
      });
      document.body.innerHTML = card({
        name: 'Dana Okafor',
        body: 'We are hiring a Zephyr RTOS firmware engineer. Apply here.',
        jobId: '111',
      });

      await applyHiringPostFilters();
      await new Promise((r) => setTimeout(r, 0));

      const cardEl = document.querySelector('div[componentkey]') as HTMLElement;
      expect(cardEl.style.opacity).toBe(''); // not dimmed by the include filter
      expect(cardEl.textContent).not.toContain('only show');
      // Everything downstream of the include check still ran normally (tag suggestion included).
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'f2a-hp-tags' }));
    });

    it('one term matching is enough — OR, not AND, across multiple include terms', async () => {
      setLocation('www.linkedin.com', '/search/results/content/');
      installChrome({ storage: fakeStorage({ f2a_hp_include_terms: ['zephyr', 'nonexistent-term-xyz'] }) });
      document.body.innerHTML = card({ name: 'Jordan Rivera', body: 'We are hiring a Zephyr RTOS engineer.' });

      await applyHiringPostFilters();

      const cardEl = document.querySelector('div[componentkey]') as HTMLElement;
      expect(cardEl.style.opacity).toBe(''); // matched "zephyr" alone — the missing second term doesn't matter
    });

    it('clearing the include terms restores the full feed', async () => {
      setLocation('www.linkedin.com', '/search/results/content/');
      installChrome({ storage: fakeStorage({ f2a_hp_include_terms: [] }) });
      document.body.innerHTML = card({ name: 'Sam Lee', body: 'We are hiring a firmware engineer for Amazon.' });

      await applyHiringPostFilters();

      const cardEl = document.querySelector('div[componentkey]') as HTMLElement;
      expect(cardEl.style.opacity).toBe(''); // empty include list — no automatic narrowing at all
    });

    it('an included post carrying an excluded tag still ends up hidden — exclude rules apply ON TOP', async () => {
      setLocation('www.linkedin.com', '/search/results/content/');
      installChrome({
        storage: fakeStorage({
          f2a_hp_include_terms: ['zephyr'],
          f2a_hp_excluded_tags: ['staffing firm'],
        }),
      });
      document.body.innerHTML = card({
        name: 'Priya Nair',
        body: 'We are hiring: a Zephyr RTOS engineer. Staffing firm reaching out on behalf of our client.',
      });

      await applyHiringPostFilters();

      const cardEl = document.querySelector('div[componentkey]') as HTMLElement;
      // Passed the include check (matched "zephyr"), but the exclude rule still hides it.
      expect(cardEl.style.opacity).toBe('0.35');
      expect(cardEl.textContent).toContain('staffing firm');
      expect(cardEl.textContent).not.toContain('only show');
    });
  });
});

describe('includeFilterStatus', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reports every post as visible when the include list is empty', async () => {
    installChrome({ storage: fakeStorage({ f2a_hp_include_terms: [] }) });
    document.body.innerHTML =
      card({ name: 'Jordan Rivera', body: HIRING_BODY, profile: '/in/jordan-rivera-000' }) +
      card({ name: 'Alex Chen', body: SEEKER_BODY, profile: '/in/alex-chen-111' });

    const status = await includeFilterStatus();
    expect(status).toEqual({ terms: [], visible: 2, total: 2 });
  });

  it('counts only the posts matching at least one include term', async () => {
    installChrome({ storage: fakeStorage({ f2a_hp_include_terms: ['zephyr'] }) });
    document.body.innerHTML =
      card({ name: 'Jordan Rivera', body: 'We are hiring a Zephyr RTOS engineer.', profile: '/in/jordan-rivera-000' }) +
      card({ name: 'Alex Chen', body: HIRING_BODY, profile: '/in/alex-chen-111' }); // no "zephyr"

    const status = await includeFilterStatus();
    expect(status).toEqual({ terms: ['zephyr'], visible: 1, total: 2 });
  });
});
