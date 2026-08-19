/**
 * The user's own cover-letter template, and the last letter we drafted.
 *
 * A template is the difference between a letter that sounds like the applicant and one that sounds like
 * a model. If they keep one, we fill its gaps from the posting; if they don't, we write from the profile
 * and say so. Either way the draft is editable before it goes anywhere — nothing is attached unread.
 *
 * On-device only. The template is the user's writing and never leaves the browser except as part of the
 * drafting call they explicitly asked for, with their own key.
 */
const TPL = 'f2a_cover_template';
const LAST = 'f2a_cover_last';

export type CoverDraft = { text: string; company?: string; at: number };

export async function getTemplate(): Promise<string> {
  try {
    return ((await chrome.storage.local.get(TPL))[TPL] as string | undefined) ?? '';
  } catch {
    return '';
  }
}

export async function setTemplate(text: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [TPL]: text.slice(0, 8000) });
  } catch {
    /* quota — the caller still holds the text */
  }
}

/** Keep the last draft so reopening the rail doesn't lose a letter the user was editing. */
export async function getLastDraft(): Promise<CoverDraft | null> {
  try {
    return ((await chrome.storage.local.get(LAST))[LAST] as CoverDraft | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function setLastDraft(d: CoverDraft): Promise<void> {
  try {
    await chrome.storage.local.set({ [LAST]: d });
  } catch {
    /* ignore */
  }
}

/** A cover letter as a file, for the many ATS that want an upload rather than a textarea. */
export function draftToFile(text: string, name = 'cover-letter.txt'): File {
  return new File([text], name, { type: 'text/plain' });
}
