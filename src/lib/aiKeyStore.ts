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

const KEY_SESSION = 'f2a_ai_key'; // secret → session only
const CFG_LOCAL = 'f2a_ai_cfg'; // { model, baseUrl } → local (non-secret)

export async function setAiConfig(cfg: AiConfig): Promise<void> {
  await chrome.storage.session.set({ [KEY_SESSION]: cfg.apiKey ?? '' });
  await chrome.storage.local.set({ [CFG_LOCAL]: { model: cfg.model ?? '', baseUrl: cfg.baseUrl ?? '' } });
}

export async function getAiConfig(): Promise<AiConfig | null> {
  const s = await chrome.storage.session.get(KEY_SESSION);
  const apiKey = (s[KEY_SESSION] as string) ?? '';
  if (!apiKey) return null;
  const l = await chrome.storage.local.get(CFG_LOCAL);
  const cfg = (l[CFG_LOCAL] as { model?: string; baseUrl?: string }) ?? {};
  return { apiKey, model: cfg.model || undefined, baseUrl: cfg.baseUrl || undefined };
}

/** The saved (non-secret) model + base URL, plus whether a key is currently held this session. */
export async function getAiConfigMeta(): Promise<{ model: string; baseUrl: string; hasKey: boolean }> {
  const [s, l] = await Promise.all([chrome.storage.session.get(KEY_SESSION), chrome.storage.local.get(CFG_LOCAL)]);
  const cfg = (l[CFG_LOCAL] as { model?: string; baseUrl?: string }) ?? {};
  return { model: cfg.model ?? '', baseUrl: cfg.baseUrl ?? '', hasKey: !!(s[KEY_SESSION] as string) };
}

export async function hasAiKey(): Promise<boolean> {
  const s = await chrome.storage.session.get(KEY_SESSION);
  return !!(s[KEY_SESSION] as string);
}

export async function clearAiConfig(): Promise<void> {
  await chrome.storage.session.remove(KEY_SESSION);
  await chrome.storage.local.remove(CFG_LOCAL);
}
