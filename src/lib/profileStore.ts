import type { Profile } from '@first2apply/autofill';

/**
 * A locally-entered profile (chrome.storage) so the extension autofills **without
 * the desktop app** — the standalone path. When the desktop is connected we prefer
 * its résumé-derived profile; otherwise we fall back to this one.
 */
const KEY = 'f2a_profile';

export async function saveProfile(profile: Profile): Promise<void> {
  await chrome.storage.local.set({ [KEY]: profile });
}

export async function loadProfile(): Promise<Profile | null> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as Profile | undefined) ?? null;
}

/** Editable fields shown in the options profile form (order = display order). */
export const PROFILE_FIELDS: { key: keyof Profile; label: string; placeholder?: string }[] = [
  { key: 'fullName', label: 'Full name', placeholder: 'Jordan Rivera' },
  { key: 'email', label: 'Email', placeholder: 'you@example.com' },
  { key: 'phone', label: 'Phone', placeholder: '(555) 010-0134' },
  { key: 'location', label: 'Location', placeholder: 'Austin, TX' },
  { key: 'linkedin', label: 'LinkedIn URL' },
  { key: 'github', label: 'GitHub URL' },
  { key: 'website', label: 'Website / portfolio' },
  { key: 'currentCompany', label: 'Current company' },
  { key: 'currentTitle', label: 'Current title' },
  { key: 'school', label: 'School' },
  { key: 'degree', label: 'Degree' },
  { key: 'fieldOfStudy', label: 'Field of study' },
];
