/**
 * VENDORED from @jobhakken/core (libraries/core/src/resume/fromReactiveResumeV5.ts), 2026-08-28 — see
 * src/lib/vendor/llm/types.ts for why core is not a runtime dependency here.
 * KEEP IN SYNC MANUALLY if the desktop/site résumé engine changes upstream.
 */
import { defaultResumeData, resumeDataSchema } from './schema';
import type { Resume } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Coerce an untyped résumé JSON into a valid Reactive Resume **v5** `ResumeData`.
 * The canonical model is now itself RR v5, so this is a validate/near-identity:
 * unwrap a few common wrappers, deep-merge over the defaults to backfill anything
 * missing, then validate. Returns the defaults if the input can't be salvaged.
 *
 * Job-Ops stores + returns RR v5 too, so importing from Job-Ops round-trips here.
 */
export function fromReactiveResumeV5(input: unknown): Resume {
  return coerceResumeData(input);
}

/** Validate/normalize any input into a `ResumeData` (defaults on failure). */
export function coerceResumeData(input: unknown): Resume {
  const data = unwrap(input);
  const merged = deepMerge(defaultResumeData, data);
  const parsed = resumeDataSchema.safeParse(merged);
  if (parsed.success) return parsed.data as Resume;
  // last resort: valid empty résumé (never throw into the renderer/store)
  return resumeDataSchema.parse(defaultResumeData) as Resume;
}

/** Tolerate a few wrappers: the data object directly, or under `data`/`resume`. */
function unwrap(input: any): any {
  if (!input || typeof input !== 'object') return {};
  if (input.basics || input.sections) return input;
  return input.data ?? input.resume ?? input;
}

/** Deep-merge `override` onto `base`: plain objects merge; arrays/primitives replace. */
function deepMerge(base: any, override: any): any {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out: any = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = deepMerge(base[key], override[key]);
  }
  return out;
}

function isPlainObject(v: any): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
