/**
 * Remembered answers — what the USER typed into a question we admitted we couldn't answer (#143).
 *
 * Distinct from `answerStore.ts`, which keys by field **signature** (a per-page-shape fingerprint) and
 * stores an engine `Mapping`. That is the right shape for "this exact control means firstName", and the
 * wrong shape for this: a signature doesn't survive moving to a different company's form, so nothing
 * would ever transfer and the panel's "Remembered" group could never populate.
 *
 * Keyed on the NORMALIZED QUESTION, with host kept only as provenance. That's deliberate: key per-site
 * and every new company on Greenhouse starts cold, throwing away most of the compounding the whole
 * approach exists for. "Are you legally authorized to work in the US?" is the same question on Lever.
 *
 * Local-only. This is user content — it never leaves the device (ADR-0003 local-always), and nothing
 * here is sent to any model or server.
 */
const KEY = 'f2a_remembered';
const MAX = 400; // bounded so a long-running install can't grow storage without limit

export type Remembered = {
  /** What the user actually typed. */
  value: string;
  /** Where it was last written — provenance for the panel ("you wrote this · 4 Aug · Ashby"). */
  host: string;
  /** When it was last written (epoch ms). */
  at: number;
  /** How many times it has been filled FROM memory — drives the promotion prompt (#144). */
  uses: number;
  /**
   * The user chose "always fill this". Only ever set by an explicit click: nothing promotes itself,
   * because a bad association that auto-promotes calcifies into a repeat mistake instead of a repeat fix.
   */
  promoted?: boolean;
};

type Store = Record<string, Remembered>;

/** Normalise a question so trivially-different renderings of it collapse to one key. */
export function normalizeQuestion(label: string): string {
  return (label ?? '')
    .toLowerCase()
    .replace(/\*/g, '') // required-field asterisk
    .replace(/\(required\)|\(optional\)/g, '')
    .replace(/[‘’]/g, "'") // curly → straight, so "what's" matches "what's"
    .replace(/\s+/g, ' ')
    .replace(/[:?.]+$/g, '')
    .trim()
    .slice(0, 160);
}

async function read(): Promise<Store> {
  try {
    return ((await chrome.storage.local.get(KEY))[KEY] as Store) ?? {};
  } catch {
    return {};
  }
}

async function write(s: Store): Promise<void> {
  try {
    // Drop the least recently written beyond the cap.
    const entries = Object.entries(s).sort((a, b) => b[1].at - a[1].at);
    await chrome.storage.local.set({ [KEY]: Object.fromEntries(entries.slice(0, MAX)) });
  } catch {
    /* storage full / unavailable — memory is an optimisation, never break a fill */
  }
}

export async function getRemembered(): Promise<Store> {
  return read();
}

export async function lookupRemembered(label: string): Promise<Remembered | undefined> {
  const q = normalizeQuestion(label);
  if (!q) return undefined;

  return (await read())[q];
}

/** Record what the user typed. Resets `promoted` when the answer CHANGES — an edited answer is a new claim. */
export async function rememberAnswer(label: string, value: string, host: string): Promise<void> {
  const q = normalizeQuestion(label);
  const v = value.trim();
  if (!q || !v) return;
  const s = await read();

  const prev = s[q];

  s[q] = {
    value: v,
    host,
    at: Date.now(),
    uses: prev?.value === v ? (prev.uses ?? 0) : 0,
    promoted: prev?.value === v ? prev.promoted : undefined,
  };
  await write(s);
}

/** Count a fill that came from memory — this is the signal the promotion prompt reads. */
export async function noteRememberedUse(label: string): Promise<number> {
  const q = normalizeQuestion(label);
  if (!q) return 0;
  const s = await read();

  const cur = s[q];
  if (!cur) return 0;
  cur.uses = (cur.uses ?? 0) + 1;
  await write(s);
  return cur.uses;
}

/** The user answered "always fill this" (or changed their mind). Explicit action only. */
export async function setPromoted(label: string, on: boolean): Promise<void> {
  const q = normalizeQuestion(label);
  if (!q) return;
  const s = await read();

  const cur = s[q];
  if (!cur) return;
  cur.promoted = on || undefined;
  await write(s);
}

export async function clearRemembered(): Promise<void> {
  try {
    await chrome.storage.local.remove(KEY);
  } catch {
    /* ignore */
  }
}

/** Forget one answer. A system that learns needs an undo, or people stop trusting it. */
export async function forgetRemembered(question: string): Promise<void> {
  const q = normalizeQuestion(question);
  const s = await read();
  if (!(q in s)) return;
  delete s[q];
  await write(s);
}

/** Correct an answer in place, keeping its history. Editing is a new claim, so promotion resets. */
export async function editRemembered(question: string, value: string): Promise<void> {
  const q = normalizeQuestion(question);
  const v = value.trim();
  const s = await read();
  const cur = s[q];
  if (!cur || !v) return;
  s[q] = { ...cur, value: v, at: Date.now(), promoted: cur.value === v ? cur.promoted : undefined };
  await write(s);
}
