import { beforeEach, describe, expect, it } from '@jest/globals';

import { estCostUsd, fmtCost, fmtTokens, getMonthUsage, monthKey, recordDraft, totalTokens } from './aiUsageStore';

// minimal chrome.storage.local shim
const mem: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(mem)) delete mem[k];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: mem[k] }),
        set: async (obj: Record<string, unknown>) => Object.assign(mem, obj),
      },
    },
  };
});

describe('aiUsageStore', () => {
  it('accumulates drafts, questions, and tokens within the month', async () => {
    await recordDraft(2, 800, 60);
    await recordDraft(1, 500, 40);
    const m = await getMonthUsage();
    expect(m.drafts).toBe(2);
    expect(m.questions).toBe(3);
    expect(m.promptTokens).toBe(1300);
    expect(m.completionTokens).toBe(100);
    expect(totalTokens(m)).toBe(1400);
    expect(m.month).toBe(monthKey());
  });

  it('starts empty', async () => {
    const m = await getMonthUsage();
    expect(m.drafts).toBe(0);
    expect(totalTokens(m)).toBe(0);
  });

  it('monthKey formats YYYY-MM', () => {
    expect(monthKey(new Date(2026, 6, 1))).toBe('2026-07');
    expect(monthKey(new Date(2026, 11, 31))).toBe('2026-12');
  });

  it('formats tokens and cost for the UI', () => {
    expect(fmtTokens(940)).toBe('940');
    expect(fmtTokens(1400)).toBe('1.4k');
    expect(fmtTokens(91300)).toBe('91k');
    expect(fmtCost(0)).toBe('$0');
    expect(fmtCost(estCostUsd(1000, 100))).toBe('<1¢'); // ~$0.0002
    expect(fmtCost(0.05)).toBe('$0.05');
  });
});
