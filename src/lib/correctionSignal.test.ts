/**
 * @jest-environment node
 *
 * Dev/test correction signal (plan §6): signature stability, gap ranking, and the privacy guard.
 */
import { afterEach, describe, expect, it } from '@jest/globals';

import type { CaptureRecord } from './captureStore';
import { aggregateCorrections, correctionCaptureEnabled, fieldSignature, normalizeLabel } from './correctionSignal';

function rec(host: string, fields: Array<[string, string, 'autofill' | 'manual' | 'empty']>): CaptureRecord {
  return {
    ts: '2026-01-01T00:00:00Z',
    url: `https://${host}/apply`,
    host,
    total: fields.length,
    resolved: 0,
    unresolved: 0,
    unresolvedLabels: [],
    filledByAutofill: fields.filter((f) => f[2] === 'autofill').length,
    filledManually: fields.filter((f) => f[2] === 'manual').length,
    fields: fields.map(([label, kind, filledBy]) => ({ label, kind, filledBy })),
    html: '',
  };
}

describe('fieldSignature / normalizeLabel', () => {
  it('normalises required marks, casing, and trailing punctuation', () => {
    expect(normalizeLabel('First Name *')).toBe('first name');
    expect(normalizeLabel('  EMAIL:  ')).toBe('email');
  });
  it('is stable and groups trivially-different labels with the same kind', () => {
    expect(fieldSignature('First Name *', 'text')).toBe(fieldSignature('first name', 'text'));
    expect(fieldSignature('Email', 'text')).not.toBe(fieldSignature('Email', 'email')); // kind matters
  });
});

describe('aggregateCorrections', () => {
  it('ranks frequently-missed fields (high manual rate) to the top', () => {
    const records: CaptureRecord[] = [
      rec('boards.greenhouse.io', [
        ['First Name', 'text', 'autofill'],
        ['Work Authorization', 'select', 'manual'],
      ]),
      rec('jobs.lever.co', [
        ['First name *', 'text', 'autofill'],
        ['Work authorization', 'select', 'manual'],
      ]),
    ];
    const ranked = aggregateCorrections(records);
    // "Work Authorization" was manual on both pages → top gap; "First Name" always autofilled → gapRate 0.
    expect(ranked[0].label).toMatch(/work authorization/i);
    expect(ranked[0].gapRate).toBe(1);
    expect(ranked[0].hosts.sort()).toEqual(['boards.greenhouse.io', 'jobs.lever.co']);
    const firstName = ranked.find((r) => /first name/i.test(r.label));
    expect(firstName?.gapRate).toBe(0);
    expect(firstName?.autofilled).toBe(2);
  });
});

describe('correctionCaptureEnabled (privacy guard)', () => {
  function mockChrome(store: Record<string, unknown>) {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: { get: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, store[k]])) } },
    };
  }
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('is true ONLY when the dev flag AND Demo mode are both on', async () => {
    mockChrome({ jh_dev_correction: true, f2a_test_mode: true });
    await expect(correctionCaptureEnabled()).resolves.toBe(true);
  });
  it('is false when Demo mode is off (would be a real user)', async () => {
    mockChrome({ jh_dev_correction: true, f2a_test_mode: false });
    await expect(correctionCaptureEnabled()).resolves.toBe(false);
  });
  it('is false when the dev flag is off', async () => {
    mockChrome({ f2a_test_mode: true });
    await expect(correctionCaptureEnabled()).resolves.toBe(false);
  });
});
