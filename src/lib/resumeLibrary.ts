/**
 * Several résumés, and remembering which one you used where.
 *
 * `resumeFileStore.ts` holds exactly one file, which is fine until you tailor a résumé per role — at
 * which point the question stops being "do I have a résumé" and becomes "which one for this job". That
 * choice is also the single most useful thing to record about an application, so we keep it per company
 * rather than making the user re-decide on every posting from the same employer.
 *
 * On-device only (`chrome.storage.local` + `unlimitedStorage`); files never leave the browser.
 */
import { getResumeFile, type StoredResume } from './resumeFileStore.js';

export type ResumeItem = StoredResume & { id: string; addedAt: number };
type Library = { items: ResumeItem[]; activeId?: string; byCompany: Record<string, string> };

const KEY = 'f2a_resume_library';
const MAX = 8; // more than this is a filing problem, not a résumé problem
const EMPTY: Library = { items: [], byCompany: {} };

async function read(): Promise<Library> {
  try {
    const lib = (await chrome.storage.local.get(KEY))[KEY] as Library | undefined;
    if (lib?.items) return { ...lib, byCompany: lib.byCompany ?? {} };
  } catch {
    /* fall through to migration */
  }
  // First run after upgrading: adopt the single stored résumé so nobody has to re-upload.
  const one = await getResumeFile().catch(() => null);
  if (!one) return EMPTY;
  const migrated: Library = {
    items: [{ ...one, id: 'legacy', addedAt: Date.now() }],
    activeId: 'legacy',
    byCompany: {},
  };
  await write(migrated);
  return migrated;
}

async function write(lib: Library): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: { ...lib, items: lib.items.slice(-MAX) } });
  } catch {
    /* quota / unavailable — the caller still has the file it just read */
  }
}

export async function listResumes(): Promise<{ items: ResumeItem[]; activeId?: string }> {
  const lib = await read();
  return { items: lib.items, activeId: lib.activeId };
}

export async function addResume(file: StoredResume): Promise<ResumeItem> {
  const lib = await read();
  const item: ResumeItem = { ...file, id: `r${Date.now().toString(36)}`, addedAt: Date.now() };
  // Replacing a file with the same name is an update, not a second copy — people re-export constantly.
  lib.items = [...lib.items.filter((i) => i.fileName !== file.fileName), item];
  lib.activeId = item.id;
  await write(lib);
  return item;
}

export async function removeResume(id: string): Promise<void> {
  const lib = await read();
  lib.items = lib.items.filter((i) => i.id !== id);
  if (lib.activeId === id) lib.activeId = lib.items[lib.items.length - 1]?.id;
  for (const [k, v] of Object.entries(lib.byCompany)) if (v === id) delete lib.byCompany[k];
  await write(lib);
}

/**
 * Pick a résumé for this application, and remember it for this company. `company` is whatever the page
 * calls the employer; the host is a reasonable fallback and is what Greenhouse boards differ by.
 */
export async function chooseResume(id: string, company?: string): Promise<void> {
  const lib = await read();
  lib.activeId = id;
  if (company) lib.byCompany[company.toLowerCase()] = id;
  await write(lib);
}

/** The résumé to attach here: what you used for this company before, else the last one you chose. */
export async function resumeFor(company?: string): Promise<ResumeItem | null> {
  const lib = await read();
  const pinned = company ? lib.byCompany[company.toLowerCase()] : undefined;
  const wanted = pinned ?? lib.activeId;
  return lib.items.find((i) => i.id === wanted) ?? lib.items[lib.items.length - 1] ?? null;
}
