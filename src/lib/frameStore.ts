/**
 * Per-tab record of which FRAME holds the application form (the frame with the most
 * fillable fields), so the popup + the keyboard command can target it with
 * `chrome.tabs.sendMessage(tabId, msg, { frameId })`.
 *
 * Why this is needed: the content script runs in EVERY frame (`all_frames: true`, so an
 * ATS embedded in a company page — e.g. Greenhouse in an <iframe> — is reached). A bare
 * `sendMessage` with no `frameId` is delivered to all of them and only the FIRST reply
 * wins, which is usually the empty top frame — so autofill / getState would hit the wrong
 * frame. The service worker learns each frame's field count from the `f2a-detected`
 * messages (it has `sender.frameId`) and records it here; readers pick the best frame.
 *
 * Stored in `chrome.storage.session` so it survives the MV3 service-worker being torn down
 * when idle (an in-memory Map would be lost on the next cold start), and is cleared when the
 * browsing session ends. Only trusted contexts (SW, popup, options) read/write it.
 */
const KEY = (tabId: number) => `f2a_frames:${tabId}`;
type FrameCounts = Record<string, number>; // frameId → fillable-field count

function pickBest(counts: FrameCounts): { frameId: number; count: number } | null {
  let best: { frameId: number; count: number } | null = null;
  for (const [fid, c] of Object.entries(counts)) {
    if (c > 0 && (!best || c > best.count)) best = { frameId: Number(fid), count: c };
  }
  return best;
}

/** Record a frame's fillable-field count; returns the current best frame for the tab (for the badge). */
export async function recordFrameFields(tabId: number, frameId: number, count: number): Promise<{ frameId: number; count: number } | null> {
  const key = KEY(tabId);
  const got = await chrome.storage.session.get(key);
  const counts = (got[key] as FrameCounts | undefined) ?? {};
  if (count > 0) counts[frameId] = count;
  else delete counts[frameId]; // a frame that no longer has fields drops out
  if (Object.keys(counts).length) await chrome.storage.session.set({ [key]: counts });
  else await chrome.storage.session.remove(key);
  return pickBest(counts);
}

/** The frame most likely to hold the form (highest field count), or undefined if unknown. */
export async function bestFrameId(tabId: number): Promise<number | undefined> {
  const got = await chrome.storage.session.get(KEY(tabId));
  return pickBest((got[KEY(tabId)] as FrameCounts | undefined) ?? {})?.frameId;
}

/** Forget a tab's frames (on tab close). */
export async function clearTabFrames(tabId: number): Promise<void> {
  await chrome.storage.session.remove(KEY(tabId));
}
