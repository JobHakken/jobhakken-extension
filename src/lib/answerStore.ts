import { createMemoryStore, type Mapping, type MappingStore } from '@jobhakken/autofill';

/**
 * The answer bank — learned field→key mappings AND remembered answers to questions the profile
 * can't cover (essays, company-specific screening Qs). Persisted to chrome.storage.local so it
 * survives across sessions and grows as the user fills real applications. Local-only: this is user
 * content and never leaves the device (ADR-0003 local-always). Reuse is at review confidence.
 *
 * chrome.storage is async but the engine's MappingStore is sync, so we hydrate an in-memory store
 * once and write through (debounced) on put.
 */
const KEY = 'jh_answer_bank';
const MAX_ENTRIES = 500; // cap so the bank can't grow unbounded

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(all: Record<string, Mapping>): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // keep the most recent MAX_ENTRIES (insertion order ≈ recency)
    const entries = Object.entries(all);
    const trimmed = entries.length > MAX_ENTRIES ? Object.fromEntries(entries.slice(-MAX_ENTRIES)) : all;
    void chrome.storage.local.set({ [KEY]: trimmed }).catch(() => {});
  }, 400);
}

export async function loadAnswerStore(): Promise<MappingStore> {
  let initial: Record<string, Mapping> = {};
  try {
    initial = ((await chrome.storage.local.get(KEY))[KEY] as Record<string, Mapping> | undefined) ?? {};
  } catch {
    /* first run / no permission — start empty */
  }
  const mem = createMemoryStore(initial);
  return {
    get: (sig) => mem.get(sig),
    all: () => mem.all(),
    put: (sig, m) => {
      mem.put(sig, m);
      persist(mem.all());
    },
  };
}

export async function clearAnswerStore(): Promise<void> {
  await chrome.storage.local.remove(KEY).catch(() => {});
}
