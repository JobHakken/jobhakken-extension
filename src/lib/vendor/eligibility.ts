/**
 * VENDORED from @jobhakken/core (libraries/core/src/eligibility.ts (the sponsorship-eligibility classifier)), 2026-08-19 — see src/lib/vendor/llm/types.ts for why.
 */
// KEEP IN SYNC MANUALLY if the desktop feed's classifier changes — this is the one piece here
// most likely to actually drift, since the ruleset gets tuned against real scanned jobs.

/**
 * Sponsorship-eligibility classifier — decides whether a job description explicitly blocks
 * candidates who need visa sponsorship. Pure keyword/regex (no LLM), so it runs anywhere
 * (extension client-side, desktop feed). Validated against real scanned jobs (see
 * scripts/eligibility-analyze.mjs): ~38% of jobs carry an explicit blocker, with the
 * negation guard preventing "sponsorship available" false positives.
 *
 * Precision-first, mirroring the reference rule: only flag when the text EXPLICITLY states
 * a blocker — never merely because sponsorship/citizenship isn't mentioned.
 */
export type EligibilityCategory = 'clearance' | 'citizenship' | 'sponsorship' | 'export';
export type EligibilityReason = { category: EligibilityCategory; phrase: string };
export type EligibilityResult = { blocked: boolean; reasons: EligibilityReason[] };

const RULES: Record<EligibilityCategory, RegExp[]> = {
  clearance: [
    /\bsecurity clearance\b/i,
    /\b(top[-\s]?secret|ts\/sci|ts-sci)\b/i,
    /\b(secret|top secret)\s+clearance\b/i,
    /\b(?:secret|top[-\s]?secret)\b[\s\w.,/&()-]{0,25}\bclearance\b/i, // "SECRET U.S. Government Clearance" (gap allows "U.S.")
    /\bactive\s+(security\s+)?clearance\b/i,
    /\b(ability|able)\s+to\s+obtain\s+(a\s+)?(security\s+)?clearance\b/i,
    /\bpolygraph\b/i,
    /\bpublic trust\b/i,
  ],
  citizenship: [
    /\b(u\.?s\.?|united states)\s+citizen(ship)?\s+(is\s+)?(required|only|mandatory)\b/i,
    /\b(must be|be a|require[sd]?)\s+(a\s+)?(u\.?s\.?|united states)\s+citizen(?![^.]{0,60}\bor\s+(?:otherwise\s+)?(?:authorized|eligible)\s+to\s+work)/i,
    /\b(u\.?s\.?|united states)\s+citizens?\s+only\b/i,
    /\bu\.?s\.?\s+person(s)?\b/i,
    /\b(green card|permanent resident)[^.]{0,30}\b(only|required|must)\b/i,
    /\b(citizens?|permanent residents?)\s+or\s+(permanent residents?|green card)[^.]{0,20}\bonly\b/i,
    /\bcitizen\s+or\s+permanent resident[^.]{0,30}\bitar\b/i,
    // permanent work-authorization requirements (no temporary visas / indefinite auth)
    /\btemporary\s+vis(?:a|as)\s+are\s+(?:ineligible|not\s+eligible)\b/i,
    /\bindefinite\s+(?:u\.?s\.?\s+|united states\s+)?work\s+authoriz(?:ation|ed)\b/i,
    /\b(?:u\.?s\.?|united states)\s+work\s+authoriz(?:ed|ation)[^.]{0,40}\bonly\b/i,
    // "U.S. Citizen or Green Card holder / Permanent Resident" as a requirement (excludes H-1B),
    // but NOT the permissive "citizens, permanent residents, or otherwise authorized to work".
    /\b(?:u\.?s\.?\s+|united states\s+)?citizens?\s*,?\s*(?:or\s+)?(?:u\.?s\.?\s+)?(?:green\s+card|permanent\s+residents?|lawful\s+permanent\s+residents?)(?![^.]{0,40}\bor\s+(?:otherwise\s+)?(?:authorized|eligible)\s+to\s+work)/i,
  ],
  sponsorship: [
    // explicit word forms (so plural "sponsorships" matches) + not "sponsorship EXPERIENCE"
    // (which is a skills line, not a work-auth blocker)
    /\b(no|not|cannot|can\s?not|unable to|does not|do not|will not|won'?t|without|not able to)\b[^.]{0,40}\bsponsor(?:ships?|ing|ed)?\b(?!\s+experience)/i,
    /\bsponsorship\s+(is\s+)?(not\s+available|unavailable|not\s+provided|not\s+offered)\b/i,
    // "Sponsorship [for work authorization, now or in the future,] is unavailable" — allow a gap
    /\bsponsor\w*\b[^.]{0,80}\b(?:is\s+)?(?:un\s?available|not\s+available|not\s+offered|not\s+provided|not\s+possible)\b/i,
    // "unable/not able to consider|accept|hire|support … sponsorship"
    /\b(?:unable|not\s+able|cannot|can\s?not)\s+to\s+(?:consider|accept|hire|employ|support|provide|offer)\b[^.]{0,45}\bsponsor\w*/i,
    /\bwithout\s+(the\s+need\s+for\s+)?sponsor\w*/i,
    /\bauthorized\s+to\s+work[^.]{0,40}without\s+(requiring\s+)?sponsor\w*/i,
  ],
  export: [/\bITAR\b/, /\bexport[-\s]?control(led|s)?\b/i, /\bexport administration regulations\b/i, /\bEAR99\b/],
};

// Phrases meaning sponsorship IS offered — must never be flagged as a sponsorship blocker.
const POSITIVE_SPONSOR =
  /\bsponsorship\s+(is\s+)?available\b|\bwill\s+sponsor\b|\bwe\s+sponsor\b|\bvisa\s+sponsorship\s+(is\s+)?(available|offered|provided)\b|\boffer\s+(visa\s+)?sponsorship\b|\bopen\s+to\s+sponsor/i;

/** Classify a job's text (title + description). Returns which explicit blockers were found. */
export function classifyEligibility(text: string): EligibilityResult {
  if (!text) return { blocked: false, reasons: [] };
  const positiveSponsor = POSITIVE_SPONSOR.test(text);
  const reasons: EligibilityReason[] = [];
  for (const category of Object.keys(RULES) as EligibilityCategory[]) {
    // sponsorship is negation-sensitive: skip it when the text clearly offers sponsorship
    if (category === 'sponsorship' && positiveSponsor) continue;
    for (const re of RULES[category]) {
      const m = re.exec(text);
      if (m) {
        reasons.push({ category, phrase: m[0].trim().slice(0, 60) });
        break; // one hit per category is enough
      }
    }
  }
  return { blocked: reasons.length > 0, reasons };
}
