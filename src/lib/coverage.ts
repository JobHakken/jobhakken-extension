/**
 * Coverage intelligence, Layer 1 (#105 / privacy-coverage-intelligence.md): classify a field that
 * autofill DETECTED but could NOT fill into a small, fixed vocabulary of field *types* — so we can
 * learn *where* autofill is weak (which kinds of fields, on which ATS) without ever capturing the
 * label text, the value, or any PII.
 *
 * Privacy: classification happens entirely locally; the label/name/id are read only to pick one of the
 * bounded `MissedFieldType` enum values below — the raw strings never leave the browser. Anything we
 * can't classify returns `null` and is dropped (never emitted as "other"). This is the same
 * metadata-only guarantee as telemetry.ts: read content locally, emit only an allowlisted projection.
 */
import type { DetectedField, FieldResult, ProfileKey } from '@jobhakken/autofill';

/** Fixed vocabulary. Anything outside this set is dropped, so the emitted signal is always bounded. */
export type MissedFieldType =
  | 'name'
  | 'email'
  | 'phone'
  | 'address'
  | 'linkedin'
  | 'website'
  | 'work_auth'
  | 'sponsorship'
  | 'salary'
  | 'notice_period'
  | 'start_date'
  | 'cover_letter'
  | 'eeo_race'
  | 'eeo_gender'
  | 'eeo_veteran'
  | 'eeo_disability'
  | 'education'
  | 'experience'
  | 'work_prefs'
  | 'custom_dropdown'
  | 'file_upload';

/** ProfileKey → type. Most reliable signal: the engine already resolved the field to a known key. */
const KEY_TYPE: Partial<Record<ProfileKey, MissedFieldType>> = {
  prefix: 'name',
  suffix: 'name',
  firstName: 'name',
  middleName: 'name',
  lastName: 'name',
  fullName: 'name',
  preferredName: 'name',
  email: 'email',
  phone: 'phone',
  addressLine1: 'address',
  addressLine2: 'address',
  city: 'address',
  county: 'address',
  state: 'address',
  zipCode: 'address',
  country: 'address',
  location: 'address',
  desiredLocation: 'address',
  linkedin: 'linkedin',
  github: 'website',
  website: 'website',
  twitter: 'website',
  workAuthorization: 'work_auth',
  requiresSponsorship: 'sponsorship',
  salaryExpectation: 'salary',
  currentSalary: 'salary',
  noticePeriod: 'notice_period',
  startDate: 'start_date',
  coverLetter: 'cover_letter',
  gender: 'eeo_gender',
  pronouns: 'eeo_gender',
  raceEthnicity: 'eeo_race',
  hispanicLatino: 'eeo_race',
  veteranStatus: 'eeo_veteran',
  disabilityStatus: 'eeo_disability',
  school: 'education',
  degree: 'education',
  fieldOfStudy: 'education',
  graduationYear: 'education',
  gpa: 'education',
  currentCompany: 'experience',
  currentTitle: 'experience',
  yearsExperience: 'experience',
  willingToRelocate: 'work_prefs',
  workModel: 'work_prefs',
};

/** Keyword → type, scanned against the lowercased label+name+id when there's no resolved key. Order
 *  matters: more specific patterns first (e.g. "cover letter" before generic upload). */
const PATTERNS: readonly [RegExp, MissedFieldType][] = [
  [/cover\s*letter/, 'cover_letter'],
  [/sponsor|require.*visa|visa.*status|immigration/, 'sponsorship'],
  [/work.?authoriz|authoriz.*work|legally.*(work|authoriz)|right\s*to\s*work|eligib.*work/, 'work_auth'],
  [/salary|compensation|expected\s*pay|desired\s*(pay|salary)|ctc/, 'salary'],
  [/notice\s*period/, 'notice_period'],
  [/start\s*date|available.*start|earliest.*(start|date)/, 'start_date'],
  [/\brace\b|ethnic/, 'eeo_race'],
  [/gender|pronoun/, 'eeo_gender'],
  [/veteran|military/, 'eeo_veteran'],
  [/disab/, 'eeo_disability'],
  [/linkedin/, 'linkedin'],
  [/github|portfolio|personal\s*(web)?site|\bwebsite\b/, 'website'],
  [/upload|attach|résumé|resume|\bcv\b|choose\s*file|drag.*drop/, 'file_upload'],
  [/relocat|remote|hybrid|on-?site|work\s*model|willing\s*to/, 'work_prefs'],
  [/university|college|school|degree|major|\bgpa\b|graduat|education/, 'education'],
  [/employer|company|job\s*title|position|years.*experience|experience.*years/, 'experience'],
  [/\bphone\b|mobile|telephone/, 'phone'],
  [/\bemail\b/, 'email'],
  [/address|street|\bcity\b|zip|postal|province/, 'address'],
];

/**
 * Classify one detected-but-unfilled field into a `MissedFieldType`, or `null` if it doesn't map to
 * the fixed vocabulary (dropped, never emitted). `key` is the engine's resolved ProfileKey when it had
 * one (a 'review' field usually does; an 'unmapped' one won't).
 */
export function classifyMissedField(
  field: Pick<DetectedField, 'label' | 'name' | 'id' | 'kind'>,
  key?: ProfileKey,
): MissedFieldType | null {
  if (key && KEY_TYPE[key]) return KEY_TYPE[key] ?? null;
  const hay = `${field.label ?? ''} ${field.name ?? ''} ${field.id ?? ''}`.toLowerCase();
  for (const [re, type] of PATTERNS) if (re.test(hay)) return type;
  // Structural fallback: an un-keyworded combobox is a custom dropdown we couldn't resolve — a useful
  // "hard widget" signal on its own. Other kinds with no keyword hit are dropped.
  if (field.kind === 'combobox') return 'custom_dropdown';
  return null;
}

/**
 * Distinct `MissedFieldType`s across a fill report's non-filled fields (review + unmapped), sorted for
 * a stable emitted string. Bounded by the vocabulary; caller further caps length before sending.
 */
export function missedFieldTypes(results: readonly FieldResult[]): MissedFieldType[] {
  const set = new Set<MissedFieldType>();
  for (const r of results) {
    if (r.status === 'filled') continue;
    const t = classifyMissedField(r.field, r.resolution?.key);
    if (t) set.add(t);
  }
  return [...set].sort();
}
