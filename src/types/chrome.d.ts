// Minimal ambient Chrome extension types for Phase 7 (only what we use).
// Swap to @types/chrome when the surface grows further.
type F2aMessage = { type: string; [k: string]: unknown };

declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const local: StorageArea;
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }
    const onChanged: {
      addListener(cb: (changes: Record<string, StorageChange>, areaName: string) => void): void;
    };
  }
  namespace runtime {
    const id: string;
    const lastError: { message?: string } | undefined;
    function getURL(path: string): string;
    function getManifest(): { version: string; name: string; [k: string]: unknown };
    function openOptionsPage(): Promise<void>;
    function sendMessage(message: F2aMessage): Promise<unknown>;
    const onInstalled: { addListener(cb: (details: { reason: string }) => void): void };
    const onMessage: {
      addListener(
        cb: (message: F2aMessage, sender: { tab?: { id?: number } }, sendResponse: (response?: unknown) => void) => void | boolean,
      ): void;
    };
  }
  namespace action {
    function setBadgeText(details: { text: string; tabId?: number }): void;
    function setBadgeBackgroundColor(details: { color: string; tabId?: number }): void;
    function setTitle(details: { title: string; tabId?: number }): void;
    const onClicked: { addListener(cb: (tab: { id?: number }) => void): void };
  }
  namespace tabs {
    function sendMessage(tabId: number, message: F2aMessage): Promise<unknown>;
    function query(query: { active?: boolean; currentWindow?: boolean }): Promise<{ id?: number }[]>;
    function create(props: { url: string; active?: boolean }): Promise<{ id?: number }>;
  }
  namespace commands {
    const onCommand: { addListener(cb: (command: string) => void): void };
  }
}
