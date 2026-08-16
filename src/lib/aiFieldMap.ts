/**
 * AI field mapping: work out WHICH profile field answers a question our rules couldn't match.
 *
 * Our deterministic matcher is good at short labels ("Email") and blind to sentences — real forms ask
 * *"What's the name you'd prefer us to use throughout the interview process?"* and we'd leave it blank
 * with `preferredName` sitting right there. Rather than hand-write a regex per phrasing forever, ask a
 * model once per form which of OUR OWN profile keys each leftover question corresponds to.
 *
 * PRIVACY — the point of this design: the model receives the page's **labels** and the **names** of our
 * profile fields. It never receives a single profile VALUE. It answers with assignments
 * (`field 3 → preferredName`) and the extension substitutes the real value locally. So the user's name,
 * email, salary, and demographics never leave the machine, even though AI does the matching.
 *
 * SAFETY — it may only pick from the key list we hand it, so it cannot invent an answer. Questions with
 * legal/attestation weight are never mapped (see UNMAPPABLE): getting "Are you subject to a non-compete?"
 * wrong on someone's application is a real harm, and no profile field honestly answers it.
 */
import type { ProfileKey } from '@jobhakken/autofill';

import { chatJson, type AiConfig } from './aiClient.js';

/** One question the deterministic pass could not resolve. */
export type OpenQuestion = { id: number; label: string; kind?: string; options?: string[] };

/** field id → the profile key that answers it. */
export type FieldMap = Record<number, ProfileKey>;

/**
 * Questions we refuse to answer from a profile, whatever the model suggests. These are attestations
 * about someone's legal/employment situation: no stored field genuinely answers them, and a confident
 * wrong answer is worse than a blank the user fills in themselves.
 */
// Questions no PROFILE FIELD can answer. Note this governs the AI mapper only — it maps a field onto a
// profile key, so pointing it at "Are you subject to a non-compete?" can only ever produce nonsense
// (it once proposed the user's employer name). Employment-agreement questions get their "No" from a
// deterministic rule instead (see builtinRules), which is the owner's chosen default and overridable.
export const UNMAPPABLE =
  /(non-?compete|employment agreement|post-?employment|restrictive covenant|convicted|felony|criminal|background check|drug (test|screen)|consent|certify|attest|acknowledge|agree to the|terms and conditions|privacy policy|accommodation)/i;

/** Keep the prompt small and the model honest: only the keys the user has actually filled in. */
export function candidateKeys(profile: Partial<Record<ProfileKey, string>>): ProfileKey[] {
  return (Object.keys(profile) as ProfileKey[]).filter((k) => String(profile[k] ?? '').trim() !== '');
}

const SYSTEM =
  'You map job-application form fields to a candidate profile. You are given form field labels and a ' +
  'list of profile FIELD NAMES (never their values). For each field, reply with the profile field name ' +
  'that answers it, or null if none does. Never guess: if a field asks for something the profile does ' +
  'not cover (legal attestations, consents, company-specific questions, essays), answer null. ' +
  'Respond ONLY with JSON: {"map":{"<fieldId>":"<profileFieldName or null>"}}';

export function buildPrompt(questions: OpenQuestion[], keys: ProfileKey[]): string {
  const fields = questions
    .map(
      (q) =>
        `${q.id}. "${q.label}"${q.kind ? ` [${q.kind}]` : ''}${q.options?.length ? ` options: ${q.options.slice(0, 8).join(' | ')}` : ''}`,
    )
    .join('\n');
  return `Profile field names available:\n${keys.join(', ')}\n\nForm fields:\n${fields}\n\nJSON only.`;
}

/** Parse + sanitise the model's reply: unknown keys, unknown ids and unsafe questions are dropped. */
export function parseMap(raw: unknown, questions: OpenQuestion[], keys: ProfileKey[]): FieldMap {
  const allowed = new Set<string>(keys);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out: FieldMap = {};
  const map = (raw as { map?: Record<string, unknown> })?.map;
  if (!map || typeof map !== 'object') return out;
  for (const [idStr, keyRaw] of Object.entries(map)) {
    const id = Number(idStr);
    const q = byId.get(id);
    const key = typeof keyRaw === 'string' ? keyRaw.trim() : '';
    if (!q || !key || !allowed.has(key)) continue; // hallucinated key or id → drop
    if (UNMAPPABLE.test(q.label)) continue; // never answer an attestation from stored data
    out[id] = key as ProfileKey;
  }
  return out;
}

/**
 * Ask the model to map the leftover questions. Returns {} on any failure — AI mapping is an
 * enhancement, so a missing key, a rate limit or a malformed reply must never break autofill.
 */
export async function mapFieldsWithAi(
  cfg: AiConfig,
  questions: OpenQuestion[],
  profile: Partial<Record<ProfileKey, string>>,
  fetchImpl?: typeof fetch,
): Promise<FieldMap> {
  const keys = candidateKeys(profile);
  const askable = questions.filter((q) => q.label && !UNMAPPABLE.test(q.label)).slice(0, 40);
  if (!keys.length || !askable.length) return {};
  try {
    const raw = await chatJson(cfg, SYSTEM, buildPrompt(askable, keys), fetchImpl);
    return parseMap(raw, askable, keys);
  } catch {
    return {};
  }
}
