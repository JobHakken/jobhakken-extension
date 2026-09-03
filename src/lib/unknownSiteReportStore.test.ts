import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { markUnknownSiteReported, shouldReportUnknownSite } from './unknownSiteReportStore';

const local: Record<string, unknown> = {};
const wipe = (o: Record<string, unknown>) => {
  for (const k of Object.keys(o)) delete o[k];
};

beforeEach(() => {
  wipe(local);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: local[k] }),
        set: async (o: Record<string, unknown>) => void Object.assign(local, o),
      },
    },
  };
});

describe('unknownSiteReportStore', () => {
  it('allows reporting a host never seen before', async () => {
    expect(await shouldReportUnknownSite('example-careers.test')).toBe(true);
  });

  it('refuses a re-report of the same host within 7 days', async () => {
    await markUnknownSiteReported('example-careers.test');
    expect(await shouldReportUnknownSite('example-careers.test')).toBe(false);
  });

  it('allows a re-report once 7 days have passed', async () => {
    const real = Date.now;
    jest.spyOn(Date, 'now').mockReturnValue(real());
    await markUnknownSiteReported('example-careers.test');
    jest.spyOn(Date, 'now').mockReturnValue(real() + 8 * 864e5);
    expect(await shouldReportUnknownSite('example-careers.test')).toBe(true);
    jest.restoreAllMocks();
  });

  it('tracks hosts independently', async () => {
    await markUnknownSiteReported('a-careers.test');
    expect(await shouldReportUnknownSite('a-careers.test')).toBe(false);
    expect(await shouldReportUnknownSite('b-careers.test')).toBe(true);
  });

  it('caps the dedup map at 200 hosts, keeping the most recent', async () => {
    for (let i = 0; i < 205; i++) {
      jest.spyOn(Date, 'now').mockReturnValue(1000 + i);
      await markUnknownSiteReported(`host-${i}.test`);
    }
    jest.restoreAllMocks();
    const store = local.f2a_unknown_site_seen as Record<string, number>;
    expect(Object.keys(store).length).toBe(200);
    // the oldest 5 were evicted
    expect(store['host-0.test']).toBeUndefined();
    expect(store['host-4.test']).toBeUndefined();
    // the most recent 200 survive
    expect(store['host-5.test']).toBeDefined();
    expect(store['host-204.test']).toBeDefined();
  });
});
