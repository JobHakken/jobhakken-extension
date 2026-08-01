/**
 * Metadata-only usage telemetry (issue #43).
 *
 * Enforces an allowlist of event names + param keys — anything else is stripped, so résumé/job
 * content can NEVER leak through here. Respects an opt-out, stamps a random per-install client id,
 * and fans out to registered sinks (GA Measurement Protocol / first-party — wired separately).
 *
 * This module is INERT until a sink is registered: no network, no permissions, nothing leaves the
 * device. Sinks + the required host permissions + the privacy-policy/store disclosure land in a
 * follow-up (must be disclosed before the store is (re)submitted).
 */

// The only events we ever emit. `track()` drops anything not in this set.
const ALLOWED_EVENTS = new Set<string>([
  'extension_installed',
  'bridge_connected',
  'bridge_failed',
  'autofill_run',
  'match_scored',
  'cover_letter_generated',
  'resume_tailored',
  'resume_received', // a résumé was handed off from the website (#358) — count only, no content
  'site_candidate', // user invoked us on an UNSUPPORTED job form (#278) — salted host hash only, no URL
  'error',
  'settings_changed',
]);

// The only param keys we ever send. Note what's ABSENT: no url, company, title, name, email,
// résumé text, form values, or precise location — those can't pass the filter.
const ALLOWED_PARAM_KEYS = new Set<string>([
  'ok', // boolean success
  'fields_filled', // coarse bucket string, e.g. "1-5" | "6-15" | "16+"
  'fields_total', // coarse bucket string — total detected fields (with fields_filled → coarse fill rate)
  'ats_platform', // bounded enum: which ATS family (workday|greenhouse|…|generic) — NOT the hostname
  'missed_types', // CSV of the fixed MissedFieldType vocab (coverage.ts) — field TYPES only, never labels
  'ats_guess', // Layer 2: coarse ATS-family guess for an unsupported page (bounded enum, "unknown")
  'host_hash', // Layer 2: SALTED, truncated hash of the registrable domain — never the plaintext host
  'area', // code region for an error, e.g. "autofill" | "bridge"
  'category', // error category (NEVER the message)
  'setting_key', // which setting changed (not its value)
  'source', // coarse origin enum for an event, e.g. "web" | "bridge" (never a URL/host)
  'ext_version',
  'browser_major',
  'os',
]);

export type TelemetryParams = Record<string, string | number | boolean>;

export interface TelemetryPayload {
  event: string;
  params: TelemetryParams;
  client_id: string;
  ext_version: string;
  ts: number;
}

export type TelemetrySink = (payload: TelemetryPayload) => void | Promise<void>;

/**
 * Pure: validate the event and strip params to the allowlist. Returns null when the event isn't
 * allowed. Content-bearing keys (résumé, email, url, …) are dropped because they're not allowlisted.
 */
export function sanitize(
  event: string,
  params: TelemetryParams = {},
): { event: string; params: TelemetryParams } | null {
  if (!ALLOWED_EVENTS.has(event)) return null;
  const clean: TelemetryParams = {};
  for (const [k, v] of Object.entries(params)) {
    const t = typeof v;
    if (ALLOWED_PARAM_KEYS.has(k) && (t === 'string' || t === 'number' || t === 'boolean')) {
      clean[k] = v;
    }
  }
  return { event, params: clean };
}

const sinks: TelemetrySink[] = [];

/** Register a destination for events (GA / first-party). No sink → telemetry is a no-op. */
export function registerSink(sink: TelemetrySink): void {
  sinks.push(sink);
}

/** Test helper — clear registered sinks. */
export function _resetSinks(): void {
  sinks.length = 0;
}

const STORE_ENABLED = 'jh_telemetry_enabled';
const STORE_CLIENT_ID = 'jh_client_id';

/** Opt-out: default ON (the user can disable in Settings). Only `false` disables it. */
async function isEnabled(): Promise<boolean> {
  const r = await chrome.storage.local.get(STORE_ENABLED);
  return r[STORE_ENABLED] !== false;
}

/**
 * Stable random per-install id (pseudonymous — not derived from anything personal). The generation is
 * cached as a single promise so two concurrent track() calls can't each mint a different id (#1).
 */
let clientIdPromise: Promise<string> | undefined;
function clientId(): Promise<string> {
  return (clientIdPromise ??= (async () => {
    const r = await chrome.storage.local.get(STORE_CLIENT_ID);
    const existing = r[STORE_CLIENT_ID] as string | undefined;
    if (existing) return existing;
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ [STORE_CLIENT_ID]: id });
    return id;
  })());
}

function extVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '0';
  }
}

/** Coarse browser major + OS (disclosed metadata) — no fine-grained fingerprint (#4). */
function browserOs(): { browser_major: string; os: string } {
  try {
    const ua = navigator.userAgent;
    const major = ua.match(/Chrome\/(\d+)/)?.[1] ?? '0';
    const os = /Windows/.test(ua)
      ? 'Windows'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'other';
    return { browser_major: major, os };
  } catch {
    return { browser_major: '0', os: 'other' };
  }
}

/**
 * Record a metadata-only event. Never throws to the caller and never blocks the extension —
 * disallowed events/params are dropped, sink errors are swallowed.
 */
export async function track(event: string, params: TelemetryParams = {}): Promise<void> {
  try {
    const clean = sanitize(event, params);
    if (!clean) return;
    if (!(await isEnabled())) return;
    const payload: TelemetryPayload = {
      ...clean,
      params: { ...clean.params, ...browserOs() }, // disclosed coarse browser/OS metadata
      client_id: await clientId(),
      ext_version: extVersion(),
      ts: Date.now(),
    };
    for (const sink of sinks) {
      try {
        await sink(payload);
      } catch {
        /* one sink failing must not stop the others */
      }
    }
  } catch {
    /* storage/unexpected failure — track() must never throw to the caller (#3) */
  }
}

/** Read the opt-out preference (Settings UI). Default on. */
export async function getTelemetryEnabled(): Promise<boolean> {
  return isEnabled();
}

/** Set the opt-out preference (Settings UI). */
export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORE_ENABLED]: enabled });
}
