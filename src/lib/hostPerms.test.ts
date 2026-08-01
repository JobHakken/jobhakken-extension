import { beforeEach, describe, expect, it } from '@jest/globals';

import { ensureAiHostPermission, hasAiHostPermission, isKnownProvider, isLocalHost, originPattern } from './hostPerms';

describe('pure helpers', () => {
  it('originPattern → https://host/* for http(s), null otherwise', () => {
    expect(originPattern('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/*');
    expect(originPattern('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1/*');
    expect(originPattern('ftp://x/y')).toBeNull();
    expect(originPattern('not a url')).toBeNull();
  });

  it('isLocalHost covers loopback', () => {
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('ollama.localhost')).toBe(true);
    expect(isLocalHost('openrouter.ai')).toBe(false);
  });

  it('isKnownProvider only for hosts in the optional list', () => {
    expect(isKnownProvider('https://openrouter.ai/api/v1')).toBe(true);
    expect(isKnownProvider('https://api.openai.com/v1')).toBe(true);
    expect(isKnownProvider('https://api.groq.com/openai/v1')).toBe(true);
    expect(isKnownProvider('https://evil.example.com/v1')).toBe(false);
  });
});

describe('permission flows (mocked chrome.permissions)', () => {
  let granted: Set<string>;
  let requestReturns: boolean;
  const patternsOf = (o: { origins?: string[] }) => (o.origins ?? []).join(',');

  beforeEach(() => {
    granted = new Set<string>();
    requestReturns = true;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      permissions: {
        contains: async (o: { origins?: string[] }) => (o.origins ?? []).every((p) => granted.has(p)),
        request: async (o: { origins?: string[] }) => {
          if (requestReturns) (o.origins ?? []).forEach((p) => granted.add(p));
          return requestReturns;
        },
      },
    };
  });

  it("local endpoints need no grant ('local')", async () => {
    expect(await ensureAiHostPermission('http://127.0.0.1:1234/v1')).toBe('local');
    expect(await hasAiHostPermission('http://localhost:8080/v1')).toBe(true);
  });

  it('unknown hosts are unsupported (cannot be requested)', async () => {
    expect(await ensureAiHostPermission('https://evil.example.com/v1')).toBe('unsupported');
    expect(await ensureAiHostPermission('nonsense')).toBe('unsupported');
  });

  it('requests a known provider and returns granted on accept', async () => {
    expect(await hasAiHostPermission('https://openrouter.ai/api/v1')).toBe(false);
    expect(await ensureAiHostPermission('https://openrouter.ai/api/v1')).toBe('granted');
    expect(await hasAiHostPermission('https://openrouter.ai/api/v1')).toBe(true);
  });

  it('returns denied when the user rejects the prompt', async () => {
    requestReturns = false;
    expect(await ensureAiHostPermission('https://api.openai.com/v1')).toBe('denied');
  });

  it('short-circuits to granted when already held (no prompt)', async () => {
    granted.add('https://api.groq.com/*');
    expect(patternsOf({ origins: ['https://api.groq.com/*'] })).toContain('groq');
    expect(await ensureAiHostPermission('https://api.groq.com/openai/v1')).toBe('granted');
  });
});
