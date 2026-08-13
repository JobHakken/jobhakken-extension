import { beforeEach, describe, expect, it } from '@jest/globals';

import { resetAllData } from './resetStore';

const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const wipe = (o: Record<string, unknown>) => {
  for (const k of Object.keys(o)) delete o[k];
};

beforeEach(() => {
  wipe(local);
  wipe(session);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: local[k] }),
        set: async (o: Record<string, unknown>) => void Object.assign(local, o),
        clear: async () => wipe(local),
      },
      session: { clear: async () => wipe(session) },
    },
  };
});

describe('resetAllData', () => {
  it('wipes all local + session data but PRESERVES the desktop-app connection', async () => {
    Object.assign(local, {
      f2a_full_profile: { profile: { firstName: 'Jordan' } },
      f2a_resume_file: { base64: 'AAAA' },
      f2a_ai_cfg: { provider: 'openrouter' },
      f2a_identity: { email: 'jordan@example.com' }, // web sign-in → wiped (sign out)
      f2a_test_mode: true, // a setting → back to default
      jh_theme: 'dark',
      f2a_connection: { port: 41573, token: 'keep-me' }, // the ONE thing kept
    });
    Object.assign(session, { f2a_ai_key: 'sk-secret', 'f2a_frames:1': { 0: 3 } });

    await resetAllData();

    for (const k of [
      'f2a_full_profile',
      'f2a_resume_file',
      'f2a_ai_cfg',
      'f2a_identity',
      'f2a_test_mode',
      'jh_theme',
    ]) {
      expect(local[k]).toBeUndefined();
    }
    expect(session.f2a_ai_key).toBeUndefined();
    expect(session['f2a_frames:1']).toBeUndefined();
    // The desktop-app link survives a reset.
    expect(local.f2a_connection).toEqual({ port: 41573, token: 'keep-me' });
  });

  it('is safe when there is no connection to preserve (nothing to restore)', async () => {
    Object.assign(local, { f2a_full_profile: { x: 1 } });
    await resetAllData();
    expect(local.f2a_full_profile).toBeUndefined();
    expect(local.f2a_connection).toBeUndefined();
  });
});
