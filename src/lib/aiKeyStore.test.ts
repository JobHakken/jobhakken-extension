import { beforeEach, describe, expect, it } from '@jest/globals';

import { clearAiConfig, getAiConfig, getAiConfigMeta, hasAiKey, setAiConfig } from './aiKeyStore';

/** In-memory chrome.storage.{session,local} split (mirrors the store's two-bucket model). */
const session: Record<string, unknown> = {};
const local: Record<string, unknown> = {};
beforeEach(() => {
  for (const o of [session, local]) for (const k of Object.keys(o)) delete o[k];
  const area = (mem: Record<string, unknown>) => ({
    get: async (k: string) => ({ [k]: mem[k] }),
    set: async (o: Record<string, unknown>) => Object.assign(mem, o),
    remove: async (k: string) => delete mem[k],
  });
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { session: area(session), local: area(local) } };
});

describe('aiKeyStore — provider picker persistence (#115)', () => {
  it('round-trips the provider id alongside model + baseUrl', async () => {
    await setAiConfig({
      apiKey: 'sk-test',
      model: 'glm-4-flash',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      provider: 'glm',
    });
    expect(await getAiConfig()).toEqual({
      apiKey: 'sk-test',
      model: 'glm-4-flash',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      provider: 'glm',
    });
    const meta = await getAiConfigMeta();
    expect(meta).toMatchObject({ provider: 'glm', model: 'glm-4-flash', hasKey: true });
  });

  it('keeps the secret key in session and the provider/model/base in local', async () => {
    await setAiConfig({ apiKey: 'sk-secret', provider: 'openrouter' });
    expect(session['f2a_ai_key']).toBe('sk-secret'); // secret → session (wiped on browser close)
    expect(JSON.stringify(local)).not.toContain('sk-secret'); // never in local
    expect((local['f2a_ai_cfg'] as { provider: string }).provider).toBe('openrouter');
  });

  it('getAiConfig returns null with no key (empty session) so BYOK stays inert', async () => {
    expect(await getAiConfig()).toBeNull();
    expect(await hasAiKey()).toBe(false);
  });

  it('meta defaults provider to "" before any save', async () => {
    expect(await getAiConfigMeta()).toEqual({ provider: '', model: '', baseUrl: '', hasKey: false });
  });

  it('clear wipes both buckets', async () => {
    await setAiConfig({ apiKey: 'k', provider: 'openai' });
    await clearAiConfig();
    expect(await getAiConfig()).toBeNull();
    expect(await getAiConfigMeta()).toMatchObject({ provider: '', hasKey: false });
  });
});
