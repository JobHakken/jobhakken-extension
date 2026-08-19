/**
 * Take everything the extension has learned with you.
 *
 * Reloading an unpacked extension keeps `chrome.storage.local`; REMOVING it and loading again does not.
 * During development that difference is invisible and expensive — a corpus built over weeks of real
 * applications disappears on a reinstall, and re-filling the same forms to rebuild it is exactly the
 * work the tool exists to avoid.
 *
 * It also turns the learned corpus into something portable: a file that can seed a second machine, be
 * diffed between versions, or drive tests against real questions instead of invented ones.
 *
 * Everything here is LOCAL. This produces a file on the user's disk; nothing is uploaded.
 *
 * The AI key IS included, by explicit owner decision: re-entering it after every reinstall was costing
 * more than it protected against, and the file never leaves the machine unless the user moves it. The
 * tradeoff is real though — this file is now a credential. It should not be committed to a repository,
 * attached to an issue, or shared. `describeBackup` says so, and the exported filename does not hint at
 * a secret, so treat any backup as sensitive.
 */

/** Keys worth carrying. Anything not listed is either derived, ephemeral, or a secret. */
const BACKUP_KEYS = [
  'f2a_full_profile', // who you are
  'f2a_remembered', // answers you typed that we now offer back
  'f2a_field_stats', // structure capture — the corpus
  'f2a_resume_library', // your résumés
  'f2a_resume_file', // the legacy single résumé
  'f2a_cover_template', // your own cover-letter wording
  'f2a_cover_last',
  'jh_answer_bank', // learned field→key mappings
  'f2a_fieldmap', // per-host label→key cache
  'f2a_unfillable', // widgets we could not drive
  'f2a_capture_sites',
  'f2a_fill_sensitive',
  'f2a_progressive', // fill-as-you-scroll — a preference, and one people will not think to re-enable
  'f2a_off_sites', // sites you've silenced
  'f2a_rail_folds',
  'f2a_rail_marks',
  'f2a_needs_sponsorship',
  'f2a_hide_unsponsored',
  'f2a_ai_cfg', // provider + model (not secret)
  'f2a_ai_key_kept', // the key itself — see the note at the top of this file
  'f2a_ai_remember',
] as const;

/** Nothing is force-stripped now that the key is carried deliberately. */
const NEVER: string[] = [];

export type Backup = {
  kind: 'jobhakken-backup';
  version: number;
  extVersion: string;
  at: string;
  data: Record<string, unknown>;
};

export async function exportBackup(): Promise<Backup> {
  const all = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const k of BACKUP_KEYS) {
    if (k in all && all[k] !== undefined) data[k] = all[k];
  }
  for (const k of NEVER) delete data[k];
  return {
    kind: 'jobhakken-backup',
    version: 1,
    extVersion: chrome.runtime.getManifest().version,
    at: new Date().toISOString(),
    data,
  };
}

/**
 * Restore a backup. MERGES by default rather than replacing: the common case is restoring onto an
 * install that has already learned something, and silently discarding that would repeat the exact loss
 * this feature exists to prevent. `replace` is available for a deliberate clean restore.
 */
export async function importBackup(raw: unknown, replace = false): Promise<{ restored: number; skipped: string[] }> {
  const b = raw as Partial<Backup>;
  if (!b || b.kind !== 'jobhakken-backup' || !b.data || typeof b.data !== 'object') {
    throw new Error('That file is not a JobHakken backup');
  }
  const incoming = b.data as Record<string, unknown>;
  const current = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const skipped: string[] = [];

  for (const [k, v] of Object.entries(incoming)) {
    if (NEVER.includes(k)) {
      skipped.push(k);
      continue;
    }
    if (!(BACKUP_KEYS as readonly string[]).includes(k)) {
      skipped.push(k); // unknown key from a newer/other build — don't write blind
      continue;
    }
    out[k] = replace ? v : mergeValue(current[k], v);
  }
  await chrome.storage.local.set(out);
  return { restored: Object.keys(out).length, skipped };
}

/**
 * Merge one stored value. Plain objects (remembered answers, per-host caches) union key-wise with the
 * INCOMING side winning, which is what "restore my backup" should mean. Anything else is replaced —
 * guessing at how to merge two profiles or two arrays would be worse than taking the file at its word.
 */
function mergeValue(mine: unknown, theirs: unknown): unknown {
  if (
    mine &&
    theirs &&
    typeof mine === 'object' &&
    typeof theirs === 'object' &&
    !Array.isArray(mine) &&
    !Array.isArray(theirs)
  ) {
    return { ...(mine as object), ...(theirs as object) };
  }
  return theirs;
}

/** A filename that sorts and says what it is. */
export function backupFileName(b: Backup): string {
  return `jobhakken-backup-${b.at.slice(0, 10)}.json`;
}

/** What's actually in a backup, for a one-line summary before someone overwrites anything. */
export function describeBackup(b: Backup): string {
  const d = b.data as Record<string, Record<string, unknown> | undefined>;
  const answers = Object.keys(d.f2a_remembered ?? {}).length;
  const questions = Object.keys((d.f2a_field_stats as { labels?: object } | undefined)?.labels ?? {}).length;
  const resumes = ((d.f2a_resume_library as { items?: unknown[] } | undefined)?.items ?? []).length;
  const parts = [
    `${answers} remembered answer${answers === 1 ? '' : 's'}`,
    `${questions} question${questions === 1 ? '' : 's'} seen`,
    `${resumes} résumé${resumes === 1 ? '' : 's'}`,
  ];
  // Say it plainly: this file can be pasted into a chat or an issue by accident.
  const secret = 'f2a_ai_key_kept' in (b.data ?? {}) ? ' · contains your API key — keep it private' : '';
  return `${parts.join(' · ')} — from ${b.at.slice(0, 10)}, v${b.extVersion}${secret}`;
}
