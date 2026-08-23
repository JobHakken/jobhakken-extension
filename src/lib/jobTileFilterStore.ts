/**
 * The user's own job-tile filter rules for LinkedIn's job SEARCH results (content/jobTiles.ts) —
 * same shape and restraint as hiringPostFilterStore.ts. Only the person's own choices persist here:
 * company names and keywords they typed, and which of LinkedIn's own tile labels (Promoted, Reposted,
 * Applied, Viewed, Dismissed) they've asked to hide. No job data, no company directory, no per-tile
 * record of what was ever shown or hidden — that lives only in the live DOM, recomputed every pass.
 */
export type JobTileLabelKey = 'promoted' | 'reposted' | 'applied' | 'viewed' | 'dismissed';
export type JobTileLabelRules = Record<JobTileLabelKey, boolean>;
export type JobTileFilterRules = {
  companies: string[];
  keywords: string[];
  labels: JobTileLabelRules;
};

const RULES_KEY = 'f2a_jt_rules';
// false (default) = dim matches; true = hide them outright. Same precedent as f2a_hide_unsponsored —
// de-emphasising your own search results is recoverable, removing them isn't, so hiding stays opt-in.
const HIDE_KEY = 'f2a_hide_job_tiles';
// The #190 audit toggle: reveal what a rule is hiding (dimmed + labelled) instead of trusting it blind.
const SHOW_HIDDEN_KEY = 'f2a_jt_show_hidden';

const EMPTY_LABELS: JobTileLabelRules = {
  promoted: false,
  reposted: false,
  applied: false,
  viewed: false,
  dismissed: false,
};

function emptyRules(): JobTileFilterRules {
  return { companies: [], keywords: [], labels: { ...EMPTY_LABELS } };
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [];
}

function normalize(raw: unknown): JobTileFilterRules {
  if (!raw || typeof raw !== 'object') return emptyRules();
  const r = raw as Partial<JobTileFilterRules>;
  const labelsRaw = (r.labels ?? {}) as Partial<JobTileLabelRules>;
  return {
    companies: asStringArray(r.companies),
    keywords: asStringArray(r.keywords),
    labels: {
      promoted: !!labelsRaw.promoted,
      reposted: !!labelsRaw.reposted,
      applied: !!labelsRaw.applied,
      viewed: !!labelsRaw.viewed,
      dismissed: !!labelsRaw.dismissed,
    },
  };
}

export async function loadJobTileRules(): Promise<JobTileFilterRules> {
  const got = await chrome.storage.local.get(RULES_KEY);
  return normalize((got as Record<string, unknown>)[RULES_KEY]);
}

async function saveRules(rules: JobTileFilterRules): Promise<JobTileFilterRules> {
  await chrome.storage.local.set({ [RULES_KEY]: rules });
  return rules;
}

export async function addCompanyRule(company: string): Promise<JobTileFilterRules> {
  const rules = await loadJobTileRules();
  const c = company.trim().toLowerCase();
  if (!c || rules.companies.includes(c)) return rules;
  rules.companies.push(c);
  return saveRules(rules);
}

export async function removeCompanyRule(company: string): Promise<JobTileFilterRules> {
  const rules = await loadJobTileRules();
  const c = company.trim().toLowerCase();
  rules.companies = rules.companies.filter((x) => x !== c);
  return saveRules(rules);
}

export async function addKeywordRule(keyword: string): Promise<JobTileFilterRules> {
  const rules = await loadJobTileRules();
  const k = keyword.trim().toLowerCase();
  if (!k || rules.keywords.includes(k)) return rules;
  rules.keywords.push(k);
  return saveRules(rules);
}

export async function removeKeywordRule(keyword: string): Promise<JobTileFilterRules> {
  const rules = await loadJobTileRules();
  const k = keyword.trim().toLowerCase();
  rules.keywords = rules.keywords.filter((x) => x !== k);
  return saveRules(rules);
}

export async function setLabelRule(label: JobTileLabelKey, on: boolean): Promise<JobTileFilterRules> {
  const rules = await loadJobTileRules();
  rules.labels[label] = on;
  return saveRules(rules);
}

export function hasAnyJobTileRule(rules: JobTileFilterRules): boolean {
  return rules.companies.length > 0 || rules.keywords.length > 0 || Object.values(rules.labels).some(Boolean);
}

export async function loadHideJobTiles(): Promise<boolean> {
  const got = await chrome.storage.local.get(HIDE_KEY);
  return !!(got as Record<string, unknown>)[HIDE_KEY];
}

export async function setHideJobTiles(on: boolean): Promise<void> {
  await chrome.storage.local.set({ [HIDE_KEY]: on });
}

export async function loadShowHiddenJobTiles(): Promise<boolean> {
  const got = await chrome.storage.local.get(SHOW_HIDDEN_KEY);
  return !!(got as Record<string, unknown>)[SHOW_HIDDEN_KEY];
}

export async function setShowHiddenJobTiles(on: boolean): Promise<void> {
  await chrome.storage.local.set({ [SHOW_HIDDEN_KEY]: on });
}
