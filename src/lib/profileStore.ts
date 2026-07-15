import type { FullProfile, ProfileKey } from '@first2apply/autofill';

/**
 * The full profile (chrome.storage) so the extension autofills **without the desktop
 * app** — the standalone path. When the desktop is connected we prefer its
 * résumé-derived profile; otherwise we fall back to this one. Populated in one click
 * by "Import from résumé" (from the desktop) or edited by hand.
 */
const KEY = 'f2a_full_profile';

export async function saveFullProfile(fp: FullProfile): Promise<void> {
  await chrome.storage.local.set({ [KEY]: fp });
}

export async function loadFullProfile(): Promise<FullProfile | null> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as FullProfile | undefined) ?? null;
}

// Whether to autofill sensitive fields (EEO/salary/visa). Default ON — nothing is
// ever auto-submitted, so the user reviews on the page.
const SENSITIVE_KEY = 'f2a_fill_sensitive';
export async function loadFillSensitive(): Promise<boolean> {
  const got = await chrome.storage.local.get(SENSITIVE_KEY);
  const v = got[SENSITIVE_KEY];
  return v === undefined ? true : !!v;
}
export async function saveFillSensitive(v: boolean): Promise<void> {
  await chrome.storage.local.set({ [SENSITIVE_KEY]: v });
}

// Test mode: autofill from the built-in anonymous TEST_PROFILE instead of your real
// data, so you can test on live application pages without exposing real information.
const TEST_MODE_KEY = 'f2a_test_mode';
export async function loadTestMode(): Promise<boolean> {
  const got = await chrome.storage.local.get(TEST_MODE_KEY);
  return !!got[TEST_MODE_KEY];
}
export async function saveTestMode(v: boolean): Promise<void> {
  await chrome.storage.local.set({ [TEST_MODE_KEY]: v });
}

// Capture mode (developer): shows a "Capture fixture" button that saves a clean,
// PII-scrubbed snapshot of the current page + a resolved/unresolved coverage report.
const CAPTURE_MODE_KEY = 'f2a_capture_mode';
export async function loadCaptureMode(): Promise<boolean> {
  const got = await chrome.storage.local.get(CAPTURE_MODE_KEY);
  return !!got[CAPTURE_MODE_KEY];
}
export async function saveCaptureMode(v: boolean): Promise<void> {
  await chrome.storage.local.set({ [CAPTURE_MODE_KEY]: v });
}

export type FieldDef = { key: ProfileKey; label: string; type?: 'text' | 'textarea'; sensitive?: boolean };

/** Personal-tab single fields (order = display order). */
export const PERSONAL_FIELDS: FieldDef[] = [
  { key: 'prefix', label: 'Prefix' },
  { key: 'firstName', label: 'First name' },
  { key: 'middleName', label: 'Middle name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'suffix', label: 'Suffix' },
  { key: 'preferredName', label: 'Preferred name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'addressLine1', label: 'Address line 1' },
  { key: 'addressLine2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'county', label: 'County' },
  { key: 'state', label: 'State / Province' },
  { key: 'zipCode', label: 'Zip / Postal code' },
  { key: 'country', label: 'Country' },
  { key: 'linkedin', label: 'LinkedIn URL' },
  { key: 'github', label: 'GitHub URL' },
  { key: 'twitter', label: 'Twitter / X URL' },
  { key: 'website', label: 'Website / portfolio' },
];

/** Additional-tab fields. Sensitive ones are labeled + only ever suggested on forms. */
export const ADDITIONAL_FIELDS: FieldDef[] = [
  { key: 'currentSalary', label: 'Current salary' },
  { key: 'salaryExpectation', label: 'Expected salary', sensitive: true },
  { key: 'noticePeriod', label: 'Notice period' },
  { key: 'startDate', label: 'Earliest start date' },
  { key: 'workAuthorization', label: 'Work authorization', sensitive: true },
  { key: 'requiresSponsorship', label: 'Requires visa sponsorship?', sensitive: true },
  { key: 'willingToRelocate', label: 'Willing to relocate?' },
  { key: 'coverLetter', label: 'Default cover letter', type: 'textarea' },
  { key: 'gender', label: 'Gender', sensitive: true },
  { key: 'pronouns', label: 'Pronouns', sensitive: true },
  { key: 'raceEthnicity', label: 'Race / Ethnicity', sensitive: true },
  { key: 'hispanicLatino', label: 'Hispanic / Latino?', sensitive: true },
  { key: 'veteranStatus', label: 'Veteran status', sensitive: true },
  { key: 'disabilityStatus', label: 'Disability status', sensitive: true },
];
