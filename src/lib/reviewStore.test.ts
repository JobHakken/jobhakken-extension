import { beforeEach, describe, expect, it } from '@jest/globals';

import { markReviewShown, recordMeaningfulFill, shouldPromptReview } from './reviewStore';

const mem: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(mem)) delete mem[k];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: mem[k] }),
        set: async (o: Record<string, unknown>) => Object.assign(mem, o),
      },
    },
  };
});

describe('reviewStore', () => {
  it('does not prompt on the first meaningful fill, prompts on the second', async () => {
    await recordMeaningfulFill();
    expect(await shouldPromptReview()).toBe(false);
    await recordMeaningfulFill();
    expect(await shouldPromptReview()).toBe(true);
  });

  it('never prompts again once shown (dismiss or click)', async () => {
    await recordMeaningfulFill();
    await recordMeaningfulFill();
    expect(await shouldPromptReview()).toBe(true);
    await markReviewShown();
    expect(await shouldPromptReview()).toBe(false);
    // further fills don't resurrect it
    await recordMeaningfulFill();
    await recordMeaningfulFill();
    expect(await shouldPromptReview()).toBe(false);
  });
});
