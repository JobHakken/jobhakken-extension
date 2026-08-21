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
  isLikelyHiringPost,
  isPostSearchPage,
} from './hiringPosts';

function setLocation(hostname: string, pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname, pathname, href: `https://${hostname}${pathname}` },
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

function card(opts: { name: string; body: string; hiring?: boolean; profile?: string; jobId?: string }): string {
  const { name, body, hiring = false, profile = '/in/jordan-rivera-000', jobId } = opts;
  const jobCard = jobId ? `<div><a href="/jobs/view/${jobId}/?trackingId=abc"><span>View job</span></a></div>` : '';
  return `
  <div class="_94b267c9" componentkey="auto-component-1">
    <h2><span>Feed post</span></h2>
    <div aria-label="${name}, ${hiring ? 'Hiring Premium Profile ' : ''}3rd+">
      <a href="${profile}?miniProfileUrn=abc"><span>${name}</span></a>
      <svg role="img" aria-label="View ${name}'s profile${hiring ? ', hiring' : ''}"></svg>
      <span>Engineering Manager</span>
      <button aria-label="Follow ${name}"><span>Follow</span></button>
      <button aria-label="Open control menu for post by ${name}"></button>
    </div>
    <div>${body
      .split('\n')
      .map((line) => `<p>${line}</p>`)
      .join('')}<span>…</span><span>more</span></div>
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
    expect(posts[0].hiringBadge).toBe(true);
    expect(posts[0].body).toContain('secure boot');
    expect(posts[0].jobUrl).toBe('https://www.linkedin.com/jobs/view/4443875906/');
  });

  it('does not merge two short posts into one — the card boundary is structural, not size-based', () => {
    document.body.innerHTML =
      card({ name: 'Jordan Rivera', body: 'Hiring now.', profile: '/in/jordan-rivera-000' }) +
      card({ name: 'Alex Chen', body: 'We are hiring an RTOS engineer.', profile: '/in/alex-chen-111' });
    const posts = detectPosts();
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.authorName).sort()).toEqual(['Alex Chen', 'Jordan Rivera']);
  });

  it('skips a card already marked processed', () => {
    document.body.innerHTML = card({ name: 'Jordan Rivera', body: HIRING_BODY });
    document.querySelector('div[componentkey]')?.setAttribute('data-f2a-hp', '1');
    expect(detectPosts()).toHaveLength(0);
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
    setLocation('www.linkedin.com', '/search/results/content/');
    const { sendMessage } = installChrome();
    document.body.innerHTML = card({ name: 'Alex Chen', body: SEEKER_BODY });

    await applyHiringPostFilters();

    expect(sendMessage).not.toHaveBeenCalled();
    const cardEl = document.querySelector('div[componentkey]') as HTMLElement;
    expect(cardEl.style.opacity).toBe('0.35');
    expect(cardEl.textContent).toContain('Not a hiring post');
  });

  it('asks the service worker for tags on a real hiring post, and renders link buttons + chips', async () => {
    setLocation('www.linkedin.com', '/search/results/content/');
    const { sendMessage } = installChrome({ tags: ['recruiter agency'] });
    document.body.innerHTML = card({ name: 'Jordan Rivera', body: HIRING_BODY, jobId: '999' });

    await applyHiringPostFilters();
    await new Promise((r) => setTimeout(r, 0)); // let the pending suggestTags().then(...) settle

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'f2a-hp-tags' }));
    const row = document.querySelector('.f2a-hp-ui');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('View job ↗');
    expect(row?.textContent).toContain('Find this post ↗');
    expect(row?.textContent).toContain('recruiter agency');
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
});
