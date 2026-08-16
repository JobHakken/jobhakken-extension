/**
 * Remember AI field mappings per site, so the model is asked ONCE per form shape.
 *
 * Without this, every application on the same ATS would pay the same latency and tokens to relearn that
 * *"What's the name you'd prefer us to use?"* means `preferredName`. With it, the first Greenhouse form
 * costs one call and every later one is instant and offline — the same trick the mature extensions use
 * (JobWizard keeps a per-domain pattern cache).
 *
 * Stored per **host + label**, never per URL: job IDs differ on every posting, but the questions repeat.
 * Only a label→profile-key pair is kept — no values, nothing about the job, no page content beyond the
 * question text the user was shown anyway.
 */
import type { ProfileKey } from '@jobhakken/autofill';

const KEY = 'f2a_fieldmap';
const MAX_HOSTS = 40; // bounded so long-running installs can't grow the store without limit
const MAX_PER_HOST = 60;

type HostMap = { at: number; map: Record<string, ProfileKey> };
type Store = Record<string, HostMap>;

/** Labels vary in whitespace/case/punctuation between renders; the meaning doesn't. */
export function labelKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[*:?]+$/g, '')
    .trim()
    .slice(0, 120);
}

async function read(): Promise<Store> {
  try {
    return ((await chrome.storage.local.get(KEY))[KEY] as Store) ?? {};
  } catch {
    return {};
  }
}

/** Mappings already learned for this host, keyed by normalized label. */
export async function getCachedMap(host: string): Promise<Record<string, ProfileKey>> {
  const store = await read();
  return store[host]?.map ?? {};
}

/** Merge newly-learned label→key pairs for a host, keeping the store bounded. */
export async function cacheMap(host: string, learned: Record<string, ProfileKey>): Promise<void> {
  if (!host || !Object.keys(learned).length) return;
  try {
    const store = await read();
    const existing = store[host]?.map ?? {};
    const merged = { ...existing, ...learned };
    // Cap per host: drop the oldest-inserted entries (object order) beyond the limit.
    const entries = Object.entries(merged).slice(-MAX_PER_HOST);
    store[host] = { at: Date.now(), map: Object.fromEntries(entries) };
    // Cap hosts: keep the most recently used.
    const hosts = Object.entries(store)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_HOSTS);
    await chrome.storage.local.set({ [KEY]: Object.fromEntries(hosts) });
  } catch {
    /* cache is an optimisation — never let it break a fill */
  }
}

/** Forget everything learned (used by the Reset flow, which clears all storage anyway). */
export async function clearFieldMapCache(): Promise<void> {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    /* ignore */
  }
}
