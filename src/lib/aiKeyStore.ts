/**
 * BYO-key config for the standalone AI path. Per ADR-0009 the secret API key lives in
 * `chrome.storage.session` (memory-only, wiped on browser close, never `.local`); the non-secret
 * model + base URL persist in `.local` for convenience. Readable only from the SW / extension pages
 * (session default access = TRUSTED_CONTEXTS), never from a content script or page.
 *
 * Persistence tradeoff: a standalone BYO key is re-entered after a browser restart (by design — no
 * secret at rest). We deliberately do NOT auto-hydrate it from an E2EE snapshot in the extension
 * (that path is dropped — see #93): to avoid re-entry, connect the desktop app, which then drafts via
 * its own key over the bridge (`answer`) so no key needs to live in the extension at all.
 */
import type { AiConfig } from './aiClient.js';

const KEY_SESSION = 'f2a_ai_key'; // secret → session by default (wiped on browser close)
const KEY_LOCAL = 'f2a_ai_key_kept'; // secret → only when the user opts in to remembering it
const REMEMBER = 'f2a_ai_remember';
const CFG_LOCAL = 'f2a_ai_cfg'; // { model, baseUrl } → local (non-secret)

/** Is the user opting to keep their key across browser restarts / extension reloads? */
export async function getRememberKey(): Promise<boolean> {
  return !!(await chrome.storage.local.get(REMEMBER))[REMEMBER];
}

export async function setRememberKey(on: boolean): Promise<void> {
  await chrome.storage.local.set({ [REMEMBER]: on });
  if (on) {
    // carry whatever is in memory now into durable storage, so ticking the box doesn't lose the key
    const cur = (await chrome.storage.session.get(KEY_SESSION))[KEY_SESSION] as string | undefined;
    if (cur) await chrome.storage.local.set({ [KEY_LOCAL]: cur });
  } else {
    await chrome.storage.local.remove(KEY_LOCAL);
  }
}

export async function setAiConfig(cfg: AiConfig): Promise<void> {
  await chrome.storage.session.set({ [KEY_SESSION]: cfg.apiKey ?? '' });
  // Chrome clears session storage on every extension reload and browser restart, so without this the
  // key has to be retyped constantly — the single most-reported annoyance while testing. Opt-in only:
  // the default is still "no secret at rest" (ADR-0009).
  if (await getRememberKey()) await chrome.storage.local.set({ [KEY_LOCAL]: cfg.apiKey ?? '' });
  await chrome.storage.local.set({
    [CFG_LOCAL]: { model: cfg.model ?? '', baseUrl: cfg.baseUrl ?? '', provider: cfg.provider ?? '' },
  });
}

export async function getAiConfig(): Promise<AiConfig | null> {
  const apiKey = await readKey();
  if (!apiKey) return null;
  const l = await chrome.storage.local.get(CFG_LOCAL);
  const cfg = (l[CFG_LOCAL] as { model?: string; baseUrl?: string; provider?: string }) ?? {};
  return {
    apiKey,
    model: cfg.model || undefined,
    baseUrl: cfg.baseUrl || undefined,
    provider: cfg.provider || undefined,
  };
}

/** The saved (non-secret) provider id + model + base URL, plus whether a key is currently held. */
export async function getAiConfigMeta(): Promise<{
  provider: string;
  model: string;
  baseUrl: string;
  hasKey: boolean;
}> {
  const [key, l] = await Promise.all([readKey(), chrome.storage.local.get(CFG_LOCAL)]);
  const cfg = (l[CFG_LOCAL] as { model?: string; baseUrl?: string; provider?: string }) ?? {};
  return {
    provider: cfg.provider ?? '',
    model: cfg.model ?? '',
    baseUrl: cfg.baseUrl ?? '',
    hasKey: !!key,
  };
}

/** The key from memory, falling back to the remembered copy (re-warming memory when found there). */
async function readKey(): Promise<string> {
  const inMemory = (await chrome.storage.session.get(KEY_SESSION))[KEY_SESSION] as string | undefined;
  if (inMemory) return inMemory;
  const kept = (await chrome.storage.local.get(KEY_LOCAL))[KEY_LOCAL] as string | undefined;
  if (kept) {
    await chrome.storage.session.set({ [KEY_SESSION]: kept }); // survive the rest of this session cheaply
    return kept;
  }
  return '';
}

export async function hasAiKey(): Promise<boolean> {
  return !!(await readKey());
}

export async function clearAiConfig(): Promise<void> {
  await chrome.storage.session.remove(KEY_SESSION);
  await chrome.storage.local.remove(KEY_LOCAL);
  await chrome.storage.local.remove(CFG_LOCAL);
}
