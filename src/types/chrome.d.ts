// Minimal ambient Chrome extension types for Phase 7.1 (only what we use).
// Swap to @types/chrome when content scripts + richer APIs land in 7.2.
declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const local: StorageArea;
  }
  namespace runtime {
    const id: string;
    function getURL(path: string): string;
    const onInstalled: { addListener(cb: (details: { reason: string }) => void): void };
  }
}
