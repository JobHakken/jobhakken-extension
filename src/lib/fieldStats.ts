/**
 * Always-on structure capture (#141) — what questions application forms actually ask, how often, and in
 * what kind of control.
 *
 * **METADATA ONLY. No answers, ever.** A row is: normalized question, element kind, and which of the
 * recent forms it appeared on. There is nothing in this store that could identify a person or reveal
 * what they wrote — the user's answers live in `rememberedStore.ts`, separately, and are never copied here.
 *
 * What it buys:
 *  - "asked on 6 of your last 10 applications" on a row the profile can't cover, so the user knows
 *    whether it's worth adding to their profile
 *  - a ranked list of what to build next, from real usage instead of guesses
 *  - the evidence that licenses the ATS badge (#148)
 *
 * Its own disclosure: the Site insight view renders this store verbatim, so what's stored is exactly
 * what's on screen. That's a stronger guarantee than a policy paragraph, because it's auditable.
 */
const KEY = 'f2a_field_stats';
const MAX_FORMS = 20; // rolling window of recent application forms
const MAX_LABELS = 600;

export type FieldStat = {
  /** Element kind, e.g. text / select / react-select / radio / file. Decides fill strategy, so it's useful. */
  kind: string;
  /** Hosts this question has been seen on — bounded, for the per-ATS view. */
  hosts: string[];
  /** Which recent form ids carried it; intersected with the rolling window to get "N of your last 10". */
  forms: string[];
  /** Last seen (epoch ms). */
  at: number;
};

type Store = { forms: string[]; labels: Record<string, FieldStat> };

const EMPTY: Store = { forms: [], labels: {} };

async function read(): Promise<Store> {
  try {
    const s = (await chrome.storage.local.get(KEY))[KEY] as Store | undefined;
    return s?.labels ? s : EMPTY;
  } catch {
    return EMPTY;
  }
}

async function write(s: Store): Promise<void> {
  try {
    const labels = Object.entries(s.labels)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_LABELS);
    await chrome.storage.local.set({
      [KEY]: { forms: s.forms.slice(0, MAX_FORMS), labels: Object.fromEntries(labels) },
    });
  } catch {
    /* capture is diagnostics — never break a fill */
  }
}

/** A stable-enough id for "this application form": host + path, without the query string. */
export function formId(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.slice(0, 180);
  } catch {
    return '';
  }
}

/**
 * Record the SHAPE of a form: one entry per question, no values. Called once per form view.
 * `fields` carries already-normalized questions so this module never has to know about labels.
 */
export async function recordForm(id: string, host: string, fields: { q: string; kind: string }[]): Promise<void> {
  if (!id || !fields.length) return;
  const s = await read();
  // Move this form to the front of the rolling window (re-visiting a form must not count twice).
  s.forms = [id, ...s.forms.filter((f) => f !== id)].slice(0, MAX_FORMS);
  const now = Date.now();
  for (const { q, kind } of fields) {
    if (!q) continue;

    const cur = s.labels[q];
    if (cur) {
      cur.kind = kind || cur.kind;
      cur.at = now;
      if (!cur.hosts.includes(host)) cur.hosts = [...cur.hosts, host].slice(-8);
      cur.forms = [id, ...cur.forms.filter((f) => f !== id)].slice(0, MAX_FORMS);
    } else {
      s.labels[q] = { kind, hosts: [host], forms: [id], at: now };
    }
  }
  await write(s);
}

/** How many of the last `window` forms asked this question — the "6 of your last 10" number. */
export async function askedOnRecent(q: string, window = 10): Promise<{ hits: number; of: number }> {
  const s = await read();
  const recent = s.forms.slice(0, window);

  const stat = s.labels[q];
  if (!stat || recent.length === 0) return { hits: 0, of: recent.length };
  return { hits: stat.forms.filter((f) => recent.includes(f)).length, of: recent.length };
}

/** Everything we've learned about one host — powers the Site insight view. */
export async function statsForHost(host: string): Promise<{ q: string; kind: string; seen: number }[]> {
  const s = await read();
  return Object.entries(s.labels)
    .filter(([, v]) => v.hosts.includes(host))
    .map(([q, v]) => ({ q, kind: v.kind, seen: v.forms.length }))
    .sort((a, b) => b.seen - a.seen)
    .slice(0, 40);
}

export async function clearFieldStats(): Promise<void> {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    /* ignore */
  }
}
