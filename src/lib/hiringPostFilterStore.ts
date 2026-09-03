/**
 * The user's own, small, explicit exclude-tag list for the LinkedIn hiring-post filter
 * (content/hiringPosts.ts). Checking a suggested tag ("recruiter/agency", "wrong location") adds
 * it here; every future post whose AI-suggested tags overlap this list is dimmed without a
 * fresh AI call. Nothing else about the feature persists — no post bodies, no per-post records,
 * just this list of the user's own filtering choices.
 */
const KEY = 'f2a_hp_excluded_tags';

export async function loadExcludedTags(): Promise<string[]> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as string[] | undefined) ?? [];
}

export async function addExcludedTag(tag: string): Promise<string[]> {
  const tags = await loadExcludedTags();
  const t = tag.trim().toLowerCase();
  if (!t || tags.includes(t)) return tags;
  const next = [...tags, t];
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function removeExcludedTag(tag: string): Promise<string[]> {
  const tags = await loadExcludedTags();
  const next = tags.filter((t) => t !== tag.trim().toLowerCase());
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
