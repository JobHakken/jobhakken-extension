import { beforeEach, describe, expect, it } from '@jest/globals';

import { addExcludedTag, loadExcludedTags, removeExcludedTag } from './hiringPostFilterStore';

/** In-memory chrome.storage.local (mirrors the store's single-bucket model). */
const local: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(local)) delete local[k];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: local[k] }),
        set: async (o: Record<string, unknown>) => Object.assign(local, o),
        remove: async (k: string) => delete local[k],
      },
    },
  };
});

describe("hiringPostFilterStore — the user's own exclude-tag list (content/hiringPosts.ts)", () => {
  it('starts empty', async () => {
    expect(await loadExcludedTags()).toEqual([]);
  });

  it('adds a tag, normalized to lowercase and trimmed', async () => {
    expect(await addExcludedTag('  Recruiter Agency  ')).toEqual(['recruiter agency']);
    expect(await loadExcludedTags()).toEqual(['recruiter agency']);
  });

  it('is idempotent — adding the same tag twice keeps one entry', async () => {
    await addExcludedTag('india');
    expect(await addExcludedTag('India')).toEqual(['india']);
    expect(await loadExcludedTags()).toEqual(['india']);
  });

  it('ignores an empty/whitespace-only tag', async () => {
    expect(await addExcludedTag('   ')).toEqual([]);
    expect(await loadExcludedTags()).toEqual([]);
  });

  it('accumulates distinct tags in insertion order', async () => {
    await addExcludedTag('recruiter agency');
    await addExcludedTag('contract role');
    expect(await loadExcludedTags()).toEqual(['recruiter agency', 'contract role']);
  });

  it('removes a tag, matching case-insensitively', async () => {
    await addExcludedTag('recruiter agency');
    await addExcludedTag('contract role');
    expect(await removeExcludedTag('Recruiter Agency')).toEqual(['contract role']);
    expect(await loadExcludedTags()).toEqual(['contract role']);
  });

  it('removing a tag that is not present is a no-op', async () => {
    await addExcludedTag('india');
    expect(await removeExcludedTag('staffing firm')).toEqual(['india']);
  });

  it('persists nothing beyond this one key — no post content in local storage', async () => {
    await addExcludedTag('recruiter agency');
    expect(Object.keys(local)).toEqual(['f2a_hp_excluded_tags']);
  });
});
