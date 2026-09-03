/**
 * Receive a résumé handed off from the JobHakken website (#358 / #107). The site's "Send to extension"
 * button posts `{ type:'JH_EXT_RESUME', schema:'reactive-resume-v5', payload:<ResumeData> }` via
 * `onMessageExternal`; we map it into the same autofill `FullProfile` the rest of the extension reads.
 * Nothing leaves the browser — the résumé travels website → extension locally.
 *
 * We deliberately map the v5 structure DIRECTLY rather than importing @jobhakken/core's
 * `coerceResumeData`: that pulls the entire résumé zod schema (+ `zod/v4`) into the MV3 service-worker
 * bundle for no runtime gain here. The payload is UNTRUSTED (it crosses `onMessageExternal`), so every
 * field is read defensively and we reject anything that isn't résumé-shaped before it can overwrite the
 * user's profile. Shape mirrors `resumeDataSchema` in @jobhakken/core (reactive-resume-v5).
 */
import type { FullProfile, Profile } from '@jobhakken/autofill';
import { RESUME_SCHEMA_VERSION } from './vendor/resume/model.js';

/** Résumé schema version this build understands (ADR-0005). Was a hardcoded literal with a TODO to
 *  import it once core published the constant; #482 vendors the résumé model for the native builder,
 *  which resolves that TODO as a side effect — this is now the SAME constant the builder writes. */
export const SUPPORTED_RESUME_SCHEMA = RESUME_SCHEMA_VERSION;

/**
 * Does an inbound JH_EXT_RESUME message declare a schema we accept? The site now sends a NUMERIC
 * `schemaVersion` (= RESUME_SCHEMA_VERSION, the same field the desktop app stamps on the bridge); we
 * also accept the legacy string tag `schema:'reactive-resume-v5'` so an older site build still works.
 */
export function acceptsResumeSchema(msg: { schemaVersion?: unknown; schema?: unknown }): boolean {
  return msg.schemaVersion === SUPPORTED_RESUME_SCHEMA || msg.schema === 'reactive-resume-v5';
}

type V5Url = { url?: unknown; label?: unknown };
type V5Basics = { name?: unknown; email?: unknown; phone?: unknown; location?: unknown; url?: V5Url };
type V5ExpItem = { company?: unknown; position?: unknown; period?: unknown; description?: unknown };
type V5EduItem = { school?: unknown; degree?: unknown; area?: unknown; period?: unknown };
type V5ProfileItem = { network?: unknown; username?: unknown; website?: V5Url };
type V5Section<T> = { items?: unknown };
type V5Resume = {
  basics?: unknown;
  sections?: {
    experience?: V5Section<V5ExpItem>;
    education?: V5Section<V5EduItem>;
    profiles?: V5Section<V5ProfileItem>;
  };
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const rows = <T>(s: V5Section<T> | undefined): T[] => (Array.isArray(s?.items) ? (s.items as T[]) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/**
 * Map a Reactive-Resume-v5 payload → the extension's autofill `FullProfile`. Throws if the payload
 * isn't an object or carries nothing résumé-shaped (so a stray message can't blank the user's profile).
 * The caller turns a throw into `{ ok:false, error }`.
 */
export function resumeDataToProfile(payload: unknown): FullProfile {
  if (!payload || typeof payload !== 'object') throw new Error('résumé payload is not an object');
  const r = payload as V5Resume;
  const basics = obj(r.basics) as V5Basics;
  const sections = obj(r.sections) as NonNullable<V5Resume['sections']>;

  const name = str(basics.name);
  const sp = name.indexOf(' ');
  const firstName = sp < 0 ? name : name.slice(0, sp);
  const lastName = sp < 0 ? '' : name.slice(sp + 1).trim();

  const experience = rows<V5ExpItem>(sections.experience).map((e) => ({
    position: str(e.position),
    company: str(e.company),
    period: str(e.period),
    description: str(e.description),
  }));
  const education = rows<V5EduItem>(sections.education).map((e) => ({
    degree: str(e.degree),
    fieldOfStudy: str(e.area),
    school: str(e.school),
    period: str(e.period),
  }));

  const profiles = rows<V5ProfileItem>(sections.profiles);
  const findNetwork = (re: RegExp): string => {
    const p = profiles.find((x) => re.test(str(x.network)) || re.test(str(x.website?.url)) || re.test(str(x.username)));
    return p ? str(p.website?.url) || str(p.username) : '';
  };

  const profile: Profile = {};
  const put = (k: keyof Profile, v: string): void => {
    if (v) profile[k] = v;
  };
  put('firstName', firstName);
  put('lastName', lastName);
  put('fullName', name);
  put('email', str(basics.email));
  put('phone', str(basics.phone));
  put('city', str(basics.location));
  put('location', str(basics.location));
  put('website', str(basics.url?.url));
  put('linkedin', findNetwork(/linkedin/i));
  put('github', findNetwork(/github/i));
  put('currentTitle', experience[0]?.position ?? '');
  put('currentCompany', experience[0]?.company ?? '');

  // Require SOMETHING résumé-shaped so a random object from a trusted origin can't wipe the profile.
  if (!name && !profile.email && experience.length === 0 && education.length === 0) {
    throw new Error('payload does not look like a résumé (no name, email, experience, or education)');
  }

  return { profile, experience, education, rules: [] };
}
