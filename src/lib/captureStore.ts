/**
 * Local corpus of anonymized application-page captures (chrome.storage.local, extension
 * origin — shared between the content script that writes and the options page that
 * reads/exports). Everything here is already PII-scrubbed at capture time and never
 * leaves the machine. Used to learn which fields recur (→ seed rules) and where an LLM
 * is actually needed (→ the long tail). Bounded so days of applications don't grow
 * unboundedly.
 */
export type CaptureRecord = {
  ts: string;
  url: string;
  host: string;
  total: number;
  resolved: number;
  unresolved: number;
  unresolvedLabels: string[];
  html: string; // anonymized form region
};

const KEY = 'f2a_captures';
const MAX = 500; // rotate oldest beyond this

export async function getCaptures(): Promise<CaptureRecord[]> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as CaptureRecord[] | undefined) ?? [];
}

export async function captureCount(): Promise<number> {
  return (await getCaptures()).length;
}

/**
 * Append a capture, unless the previous one for the same URL had the same field count
 * (a re-render / re-visit of the same step — no new signal). Returns whether it was kept.
 */
export async function addCapture(rec: CaptureRecord): Promise<boolean> {
  const all = await getCaptures();
  const dupe = all.some((c) => c.url === rec.url && c.total === rec.total);
  if (dupe) return false;
  all.push(rec);
  if (all.length > MAX) all.splice(0, all.length - MAX);
  await chrome.storage.local.set({ [KEY]: all });
  return true;
}

export async function clearCaptures(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
