/**
 * The résumé FILE to attach to applications (separate from the parsed profile text). Traditionally the
 * desktop app renders/serves this; a standalone / BYO user has no desktop, so we let them upload a
 * résumé here and store it for attaching. On-device only (chrome.storage.local + unlimitedStorage);
 * never sent to a JobHakken server.
 */

export type StoredResume = { base64: string; fileName: string; mimeType: string };

const KEY = 'f2a_resume_file';

/** Store a résumé file (base64 body, no data: prefix). */
export async function setResumeFile(file: StoredResume): Promise<void> {
  await chrome.storage.local.set({ [KEY]: file });
}

export async function getResumeFile(): Promise<StoredResume | null> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as StoredResume | undefined) ?? null;
}

export async function clearResumeFile(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}

/** Encode raw bytes to base64 (chunked so large files don't overflow the call stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
}
