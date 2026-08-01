import { beforeEach, describe, expect, it } from '@jest/globals';

import { bytesToBase64, clearResumeFile, getResumeFile, setResumeFile } from './resumeFileStore';

const mem: Record<string, unknown> = {};
beforeEach(() => {
  for (const k of Object.keys(mem)) delete mem[k];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: mem[k] }),
        set: async (o: Record<string, unknown>) => Object.assign(mem, o),
        remove: async (k: string) => delete mem[k],
      },
    },
  };
});

describe('resumeFileStore', () => {
  it('saves, loads, and clears the résumé file', async () => {
    expect(await getResumeFile()).toBeNull();
    await setResumeFile({ base64: 'AAAA', fileName: 'r.pdf', mimeType: 'application/pdf' });
    expect((await getResumeFile())?.fileName).toBe('r.pdf');
    await clearResumeFile();
    expect(await getResumeFile()).toBeNull();
  });

  it('bytesToBase64 round-trips', () => {
    const bytes = new Uint8Array([37, 80, 68, 70]); // "%PDF"
    expect(atob(bytesToBase64(bytes))).toBe('%PDF');
  });
});
