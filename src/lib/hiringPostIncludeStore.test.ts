import { beforeEach, describe, expect, it } from '@jest/globals';

import { addIncludeTerm, loadIncludeTerms, removeIncludeTerm } from './hiringPostIncludeStore';

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

describe('hiringPostIncludeStore — the user\'s own "only show" include-term list (content/hiringPosts.ts, #186)', () => {
  it('starts empty', async () => {
    expect(await loadIncludeTerms()).toEqual([]);
  });

  it('adds a term, normalized to lowercase and trimmed', async () => {
    expect(await addIncludeTerm('  Zephyr  ')).toEqual(['zephyr']);
    expect(await loadIncludeTerms()).toEqual(['zephyr']);
  });

  it('is idempotent — adding the same term twice keeps one entry', async () => {
    await addIncludeTerm('embedded');
    expect(await addIncludeTerm('Embedded')).toEqual(['embedded']);
    expect(await loadIncludeTerms()).toEqual(['embedded']);
  });

  it('ignores an empty/whitespace-only term', async () => {
    expect(await addIncludeTerm('   ')).toEqual([]);
    expect(await loadIncludeTerms()).toEqual([]);
  });

  it('accumulates distinct terms in insertion order', async () => {
    await addIncludeTerm('embedded');
    await addIncludeTerm('firmware');
    expect(await loadIncludeTerms()).toEqual(['embedded', 'firmware']);
  });

  it('removes a term, matching case-insensitively', async () => {
    await addIncludeTerm('embedded');
    await addIncludeTerm('firmware');
    expect(await removeIncludeTerm('Embedded')).toEqual(['firmware']);
    expect(await loadIncludeTerms()).toEqual(['firmware']);
  });

  it('removing a term that is not present is a no-op', async () => {
    await addIncludeTerm('embedded');
    expect(await removeIncludeTerm('zephyr')).toEqual(['embedded']);
  });

  it('persists nothing beyond this one key — no post content in local storage', async () => {
    await addIncludeTerm('embedded');
    expect(Object.keys(local)).toEqual(['f2a_hp_include_terms']);
  });

  it('uses a distinct storage key from the exclude-tag list — the two never collide', async () => {
    await addIncludeTerm('embedded');
    expect(Object.keys(local)).not.toContain('f2a_hp_excluded_tags');
  });
});
