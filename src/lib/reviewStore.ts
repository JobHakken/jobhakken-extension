/**
 * Organic review prompt (features plan D1). After a couple of *meaningful* autofills we show one
 * dismissible "leave a review" banner in the popup — once per user, ever. Purely local; a simple
 * counter in chrome.storage.local, no network, no telemetry.
 */

const KEY = 'f2a_review_prompt';
const THRESHOLD = 2; // show on the 2nd meaningful success (not the very first — earn it first)

/** Chrome Web Store reviews page for the JobHakken extension. */
export const REVIEW_URL = 'https://chromewebstore.google.com/detail/lochgcghpahlooibepjlmmcdjgicncil/reviews';

type State = { successes: number; shown: boolean };

async function get(): Promise<State> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as State | undefined) ?? { successes: 0, shown: false };
}
async function set(s: State): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

/** Count one meaningful autofill (caller decides "meaningful", e.g. ≥8 fields). No-op once shown. */
export async function recordMeaningfulFill(): Promise<void> {
  const s = await get();
  if (s.shown) return;
  s.successes += 1;
  await set(s);
}

/** True at most once ever — enough meaningful fills and not yet shown. */
export async function shouldPromptReview(): Promise<boolean> {
  const s = await get();
  return !s.shown && s.successes >= THRESHOLD;
}

/** Mark the banner as shown so it never appears again (dismiss or click both call this). */
export async function markReviewShown(): Promise<void> {
  await set({ successes: THRESHOLD, shown: true });
}
