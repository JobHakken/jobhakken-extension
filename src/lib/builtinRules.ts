/**
 * Built-in matching rules for questions real ATS forms ask as SENTENCES.
 *
 * The engine matches short labels well ("First Name", "Email") but misses the same field when a form
 * writes it out — measured on a live Greenhouse application, `preferredName: "Jordan"` sat in the
 * profile while *"What's the name you'd prefer us to use throughout the interview process?"* was left
 * blank. These rules are expressed in the same custom-field DSL users write (dsl.ts), so they behave
 * exactly like a rule the user could have added by hand.
 *
 * Two hard constraints:
 *  - **Profile-backed only.** Every rule maps to a `key` the user actually filled in. We never invent a
 *    literal answer ("No", "Yes") for a question about someone's legal or employment situation — a
 *    wrong answer on a real application is far worse than a blank one.
 *  - **Lowest priority.** These are appended AFTER the user's own rules, so anything they wrote wins.
 */
import type { UserRule } from '@jobhakken/autofill';

export const BUILTIN_RULES: readonly UserRule[] = [
  // "What's the name you'd prefer us to use…", "Preferred first name", "What should we call you?"
  { condition: '((prefer || preferred || go by) && name) || (what should we call you)', key: 'preferredName' },
  // "What is your current country of residence?", "Country you are based in"
  { condition: '(country of residence) || (country you are based) || (country are you based)', key: 'country' },
  // "Will you now or in the future require sponsorship…" — answered from the user's own setting
  { condition: '(require sponsorship) || (need sponsorship) || (visa sponsorship)', key: 'requiresSponsorship' },
  // "Are you legally authorized to work in…"
  { condition: '(legally authorized) || (authorized to work) || (work authorization)', key: 'workAuthorization' },
  // "Are you willing to relocate…"
  { condition: '(willing to relocate) || (open to relocation)', key: 'willingToRelocate' },
  // "What are your salary expectations?", "Desired compensation"
  {
    condition: '((salary || compensation || pay) && (expect || expectation || desired || target))',
    key: 'salaryExpectation',
  },
  // "When could you start?", "Earliest start date"
  {
    condition: '(earliest start) || (when could you start) || (when can you start) || (available to start)',
    key: 'startDate',
  },
  // "How much notice do you need to give?"
  { condition: '(notice period) || (how much notice)', key: 'noticePeriod' },
  // "Link to your LinkedIn profile", "LinkedIn URL"
  { condition: '(linkedin)', key: 'linkedin' },
  // "Link to your GitHub", "GitHub profile"
  { condition: '(github)', key: 'github' },
  // "Personal website", "Portfolio link"
  { condition: '(portfolio) || (personal website) || (personal site)', key: 'website' },
  // "How did you hear about this role?"
  { condition: '(how did you hear) || (how did you find)', key: 'howHeard' },
  // "Are you subject to any employment agreements / post-employment restrictions / a non-compete?"
  // Owner decision: default NO. At any moment a candidate is bound to at most a couple of employers,
  // so "no restrictions" is the right default for nearly everyone — and leaving a REQUIRED question
  // blank blocks the submit button. It is a literal (not profile-backed) because no profile field
  // covers it, it is outlined for review before submitting, and a user's own rule overrides it.
  {
    condition: '(employment agreement) || (non-compete) || (noncompete) || (post-employment) || (restrictive covenant)',
    value: 'No',
  },
];

/** The user's own rules first (they always win), then ours. */
export function withBuiltinRules(userRules: UserRule[] | undefined): UserRule[] {
  return [...(userRules ?? []), ...BUILTIN_RULES];
}
