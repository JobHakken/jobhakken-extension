/**
 * Local corpus of anonymized application-page captures (chrome.storage.local, extension
 * origin — shared between the content script that writes and the options page that
 * reads/exports). Everything here is PII-scrubbed at capture time and never leaves the
 * machine. Used to learn which fields recur (→ seed rules) and where an LLM is actually
 * needed (→ the long tail).
 *
 * Records are stored under per-record keys (`f2a_cap:<ts>`) with a small separate index,
 * so appending a capture doesn't rewrite the whole (potentially many-MB) corpus.
 */
/** One field in a captured application flow — who filled it and (PII-safe) what. */
export type CaptureField = {
  label: string;
  key?: string; // resolved profile key, if any
  kind: string;
  filledBy: 'autofill' | 'manual' | 'empty';
  value?: string; // PII-safe: known details scrubbed, emails/phones/long-text → shapes
};

export type CaptureRecord = {
  ts: string;
  url: string;
  host: string;
  total: number;
  resolved: number;
  unresolved: number;
  unresolvedLabels: string[];
  filledByAutofill: number;
  filledManually: number;
  fields: CaptureField[]; // the completed flow (autofill + manual)
  html: string; // anonymized form region (structure)
};

type IndexEntry = { key: string; ts: string; url: string; host: string; total: number; resolved: number; unresolved: number; filledManually: number };

const INDEX = 'f2a_cap_index';
const REC = (ts: string) => `f2a_cap:${ts}`;
const MAX = 800; // rotate oldest beyond this

async function getIndex(): Promise<IndexEntry[]> {
  const got = await chrome.storage.local.get(INDEX);
  return (got[INDEX] as IndexEntry[] | undefined) ?? [];
}

export async function captureCount(): Promise<number> {
  return (await getIndex()).length;
}

/**
 * Upsert a capture by URL — the record for a page EVOLVES as the flow is filled (autofill
 * then manual edits), so we replace the prior snapshot for that URL with the latest rather
 * than appending duplicates. Returns whether anything was written.
 */
export async function upsertCapture(rec: CaptureRecord): Promise<boolean> {
  const index = await getIndex();
  const entry = { ts: rec.ts, url: rec.url, host: rec.host, total: rec.total, resolved: rec.resolved, unresolved: rec.unresolved, filledManually: rec.filledManually };
  const existing = index.find((e) => e.url === rec.url);
  const key = existing?.key ?? REC(rec.ts);
  if (existing) Object.assign(existing, entry, { key });
  else index.push({ key, ...entry });
  const evict: string[] = [];
  while (index.length > MAX) evict.push(index.shift()!.key);
  await chrome.storage.local.set({ [key]: rec, [INDEX]: index });
  if (evict.length) await chrome.storage.local.remove(evict);
  return true;
}

/** All full capture records (loads HTML — used for export). */
export async function getCaptures(): Promise<CaptureRecord[]> {
  const index = await getIndex();
  if (!index.length) return [];
  const got = await chrome.storage.local.get(index.map((e) => e.key));
  return index.map((e) => got[e.key] as CaptureRecord).filter(Boolean);
}

export async function clearCaptures(): Promise<void> {
  const index = await getIndex();
  await chrome.storage.local.remove([INDEX, ...index.map((e) => e.key)]);
}

// ── where auto-capture is allowed ────────────────────────────
/** Known ATS application hosts — auto-capture runs here by default. */
const ATS_HOSTS: RegExp[] = [
  /myworkdayjobs\.com$/i,
  /\.myworkday\.com$/i,
  /(^|\.)greenhouse\.io$/i,
  /(^|\.)lever\.co$/i,
  /(^|\.)ashbyhq\.com$/i,
  /(^|\.)icims\.com$/i,
  /(^|\.)smartrecruiters\.com$/i,
  /(^|\.)workable\.com$/i,
  /\.taleo\.net$/i,
  /successfactors\.(com|eu)$/i,
  /(^|\.)bamboohr\.com$/i,
  /(^|\.)jobvite\.com$/i,
  /(^|\.)jobs\.[a-z0-9-]+\.com$/i, // common "jobs.<company>.com" career hosts
];

export function isAtsHost(host: string): boolean {
  return ATS_HOSTS.some((re) => re.test(host));
}

const OPT_IN = 'f2a_capture_sites';
export async function getOptInSites(): Promise<string[]> {
  const got = await chrome.storage.local.get(OPT_IN);
  return (got[OPT_IN] as string[] | undefined) ?? [];
}
export async function setSiteOptIn(host: string, on: boolean): Promise<void> {
  const sites = new Set(await getOptInSites());
  if (on) sites.add(host);
  else sites.delete(host);
  await chrome.storage.local.set({ [OPT_IN]: [...sites] });
}

/** Auto-capture allowed on this host? Known ATS, or the user opted this site in. */
export async function isCaptureAllowed(host: string): Promise<boolean> {
  if (isAtsHost(host)) return true;
  return (await getOptInSites()).includes(host);
}
