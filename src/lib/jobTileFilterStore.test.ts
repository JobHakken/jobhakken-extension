import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  addCompanyRule,
  addKeywordRule,
  hasAnyJobTileRule,
  loadHideJobTiles,
  loadJobTileRules,
  loadShowHiddenJobTiles,
  removeCompanyRule,
  removeKeywordRule,
  setHideJobTiles,
  setLabelRule,
  setShowHiddenJobTiles,
} from './jobTileFilterStore';

/** In-memory chrome.storage.local (mirrors the store's single-bucket model). */
const local: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(local)) delete local[k];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: local[k] }),
        set: async (o: Record<string, unknown>) => Object.assign(local, o),
      },
    },
  };
});

describe("jobTileFilterStore — the user's own LinkedIn job-tile rules (content/jobTiles.ts)", () => {
  it('starts empty', async () => {
    expect(await loadJobTileRules()).toEqual({
      companies: [],
      keywords: [],
      labels: { promoted: false, reposted: false, applied: false, viewed: false, dismissed: false },
    });
  });

  it('adds a company rule, normalized to lowercase and trimmed', async () => {
    await addCompanyRule('  Apex Staffing  ');
    expect((await loadJobTileRules()).companies).toEqual(['apex staffing']);
  });

  it('is idempotent — adding the same company twice keeps one entry', async () => {
    await addCompanyRule('Apex Staffing');
    await addCompanyRule('apex staffing');
    expect((await loadJobTileRules()).companies).toEqual(['apex staffing']);
  });

  it('ignores an empty/whitespace-only company', async () => {
    await addCompanyRule('   ');
    expect((await loadJobTileRules()).companies).toEqual([]);
  });

  it('removes a company rule, matching case-insensitively', async () => {
    await addCompanyRule('Apex Staffing');
    await addCompanyRule('Beta Corp');
    await removeCompanyRule('APEX STAFFING');
    expect((await loadJobTileRules()).companies).toEqual(['beta corp']);
  });

  it('removing a company that is not present is a no-op', async () => {
    await addCompanyRule('apex staffing');
    await removeCompanyRule('nonexistent');
    expect((await loadJobTileRules()).companies).toEqual(['apex staffing']);
  });

  it('adds and removes a keyword rule the same way', async () => {
    await addKeywordRule('  Senior  ');
    expect((await loadJobTileRules()).keywords).toEqual(['senior']);
    await removeKeywordRule('SENIOR');
    expect((await loadJobTileRules()).keywords).toEqual([]);
  });

  it('sets one label rule without disturbing the others', async () => {
    await setLabelRule('promoted', true);
    await setLabelRule('dismissed', true);
    const rules = await loadJobTileRules();
    expect(rules.labels).toEqual({
      promoted: true,
      reposted: false,
      applied: false,
      viewed: false,
      dismissed: true,
    });
  });

  it('hasAnyJobTileRule is false until a company, keyword, or label rule exists', async () => {
    expect(hasAnyJobTileRule(await loadJobTileRules())).toBe(false);
    await setLabelRule('viewed', true);
    expect(hasAnyJobTileRule(await loadJobTileRules())).toBe(true);
  });

  it('hide-vs-dim preference defaults to dim (false) and can be flipped independently of rules', async () => {
    expect(await loadHideJobTiles()).toBe(false);
    await setHideJobTiles(true);
    expect(await loadHideJobTiles()).toBe(true);
  });

  it('the #190 show-hidden audit toggle defaults to off', async () => {
    expect(await loadShowHiddenJobTiles()).toBe(false);
    await setShowHiddenJobTiles(true);
    expect(await loadShowHiddenJobTiles()).toBe(true);
  });

  it('persists nothing beyond the rules + two preference keys — no job data in local storage', async () => {
    await addCompanyRule('apex staffing');
    await setHideJobTiles(true);
    await setShowHiddenJobTiles(true);
    expect(Object.keys(local).sort()).toEqual(['f2a_hide_job_tiles', 'f2a_jt_rules', 'f2a_jt_show_hidden']);
  });
});
