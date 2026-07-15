import type { BridgeConnection } from './bridgeClient';

/**
 * Persist the bridge connection (port + token + cached profile) in
 * chrome.storage.local so the profile is available offline — learned autofill
 * (later slices) works even when the desktop app is closed.
 */
const KEY = 'f2a_connection';

export async function saveConnection(conn: BridgeConnection): Promise<void> {
  await chrome.storage.local.set({ [KEY]: conn });
}

export async function loadConnection(): Promise<BridgeConnection | null> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as BridgeConnection | undefined) ?? null;
}

export async function clearConnection(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
