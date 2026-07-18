/**
 * @jest-environment node
 *
 * Service-worker H-1B sponsor matching — the standalone lookup the H-1B content script drives.
 * This exercises the REAL pipeline: normalizeCompanyName() (legal-entity + punctuation + case
 * normalization) → the sorted binary-search prefix sum in h1bSum() that adds a brand's exact
 * and word-prefix legal-entity entries.
 *
 * We mock chrome + fetch with a tiny synthetic, pre-sorted sponsor list (the same
 * `normalizedName\tapprovals` format as the bundled data), then dispatch the `f2a-h1b` message
 * to the worker's captured listener. The worker registers listeners at import time, so we set
 * up the chrome/fetch globals first and use a dynamic import. All companies are example data.
 */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';

// Pre-sorted (JS string order) synthetic index. Note the word-boundary trap "emersonx": a query
// of "emerson" must sum emerson + "emerson electric" + "emerson process management" but NOT
// "emersonx" (no space at the query boundary), i.e. 4050, never 4149.
const SPONSORS = ['acme\t1200', 'emerson\t50', 'emerson electric\t3400', 'emerson process management\t600', 'emersonx\t99', 'google\t9000', 'microsoft\t8000'].join('\n');

type Listener = (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;
const messageListeners: Listener[] = [];

/** Send an f2a-h1b message to the worker and resolve with its `matches` map. */
function lookup(companies: string[]): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    for (const fn of messageListeners) {
      fn({ type: 'f2a-h1b', companies }, {}, (res) => resolve((res as { matches?: Record<string, number> })?.matches ?? {}));
    }
  });
}

beforeAll(async () => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: { addListener: (fn: Listener) => messageListeners.push(fn) },
      getURL: (p: string) => `chrome-extension://test/${p}`,
    },
    tabs: { onRemoved: { addListener: () => {} }, query: async () => [] },
    commands: { onCommand: { addListener: () => {} } },
    action: { setBadgeBackgroundColor: () => {}, setBadgeText: () => {}, setTitle: () => {} },
    storage: {
      session: { get: async () => ({}), set: async () => {} },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
  };
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, text: async () => SPONSORS }));
  await import('./serviceWorker'); // registers the f2a-h1b listener against the mocked chrome
});

describe('service-worker H-1B sponsor matching', () => {
  it('matches an exact company, dropping the legal-entity suffix (Inc)', async () => {
    expect(await lookup(['Acme Inc'])).toEqual({ 'Acme Inc': 1200 });
  });

  it('is case-insensitive and ignores punctuation (LLC, commas, periods)', async () => {
    expect(await lookup(['ACME, LLC.'])).toEqual({ 'ACME, LLC.': 1200 });
  });

  it('sums a brand across its legal entities via word-prefix, respecting word boundaries', async () => {
    // emerson(50) + emerson electric(3400) + emerson process management(600) = 4050; emersonx excluded
    expect(await lookup(['Emerson'])).toEqual({ Emerson: 4050 });
  });

  it('returns no entry for a company that is not a known sponsor', async () => {
    expect(await lookup(['Totally Unknown Co'])).toEqual({});
  });

  it('resolves several companies in one call (keyed by the raw input)', async () => {
    expect(await lookup(['Google LLC', 'Microsoft'])).toEqual({ 'Google LLC': 9000, Microsoft: 8000 });
  });
});
