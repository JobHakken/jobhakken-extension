/**
 * The user's own "only show posts matching" include-term list (#186) — a second, independent list
 * alongside the exclude-tag list (hiringPostFilterStore.ts). When non-empty, content/hiringPosts.ts
 * dims every post whose body matches NONE of these terms; matching just one term is enough (OR, not
 * AND — requiring every term to match would hide nearly everything, see the issue). Nothing else about
 * this list persists: no post bodies, no per-post records, just the user's own filter terms.
 */
const KEY = 'f2a_hp_include_terms';

export async function loadIncludeTerms(): Promise<string[]> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as string[] | undefined) ?? [];
}

export async function addIncludeTerm(term: string): Promise<string[]> {
  const terms = await loadIncludeTerms();
  const t = term.trim().toLowerCase();
  if (!t || terms.includes(t)) return terms;
  const next = [...terms, t];
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function removeIncludeTerm(term: string): Promise<string[]> {
  const terms = await loadIncludeTerms();
  const next = terms.filter((t) => t !== term.trim().toLowerCase());
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
