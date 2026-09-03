/**
 * The résumé DRAFT built natively in the extension's own résumé builder — structured data (the
 * `Resume` shape from `src/lib/vendor/resume`), not a file. Separate from `resumeFileStore.ts`, which
 * holds a raw PDF/DOCX blob for someone who already has a résumé and just wants to attach it.
 *
 * Mirrors the website builder's `localStorage['jh.resume.draft']` (see jobhakken-site's
 * `resume-builder.tsx`), moved to `chrome.storage.local` so it lives alongside every other piece of
 * profile data this extension keeps. On-device only, per ADR-0003 — never sent to a JobHakken server,
 * and no different in that respect from the file store next to it.
 */
import type { Resume } from './vendor/resume/model.js';

export type ResumeDraft = { resume: Resume; templateId: string };

const KEY = 'f2a_resume_draft';

export async function getResumeDraft(): Promise<ResumeDraft | null> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as ResumeDraft | undefined) ?? null;
}

export async function setResumeDraft(draft: ResumeDraft): Promise<void> {
  await chrome.storage.local.set({ [KEY]: draft });
}

export async function clearResumeDraft(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
