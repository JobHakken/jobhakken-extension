/**
 * Local AI-usage tally for the popup's quota UX (telemetry plan §C Layer 3). Purely on-device
 * (`chrome.storage.local`), month-keyed, never sent anywhere — the BYO path emits ZERO server
 * telemetry, so this is the only place usage is visible, and it's the user's own record.
 */

export type MonthTally = { drafts: number; questions: number; promptTokens: number; completionTokens: number };
type UsageStore = Record<string, MonthTally>; // 'YYYY-MM' → tally

const KEY = 'f2a_ai_usage';
const KEEP_MONTHS = 6;

export function monthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const empty = (): MonthTally => ({ drafts: 0, questions: 0, promptTokens: 0, completionTokens: 0 });

/** Record one draft action (a single batched call that produced `questions` answers). */
export async function recordDraft(questions: number, promptTokens = 0, completionTokens = 0): Promise<void> {
  const got = await chrome.storage.local.get(KEY);
  const store: UsageStore = (got[KEY] as UsageStore) ?? {};
  const mk = monthKey();
  const m = store[mk] ?? empty();
  m.drafts += 1;
  m.questions += questions;
  m.promptTokens += promptTokens;
  m.completionTokens += completionTokens;
  store[mk] = m;
  // prune to the last N months so this never grows unbounded
  const keys = Object.keys(store).sort();
  while (keys.length > KEEP_MONTHS) delete store[keys.shift() as string];
  await chrome.storage.local.set({ [KEY]: store });
}

/** This calendar month's tally (zeros if nothing yet). */
export async function getMonthUsage(): Promise<MonthTally & { month: string }> {
  const got = await chrome.storage.local.get(KEY);
  const store: UsageStore = (got[KEY] as UsageStore) ?? {};
  const mk = monthKey();
  return { ...(store[mk] ?? empty()), month: mk };
}

/** Total tokens = prompt + completion. */
export const totalTokens = (m: { promptTokens: number; completionTokens: number }): number =>
  m.promptTokens + m.completionTokens;

/** Compact token label, e.g. 940 → "940", 9130 → "9.1k". */
export function fmtTokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

/** Rough cost estimate at gpt-4o-mini reference rates ($0.15/1M in, $0.60/1M out). Marked "≈" in UI
 * because the actual rate depends on the user's chosen model/provider. */
export function estCostUsd(promptTokens: number, completionTokens: number): number {
  return (promptTokens / 1_000_000) * 0.15 + (completionTokens / 1_000_000) * 0.6;
}

/** Friendly cost string: "<1¢" under a cent, else "$0.0X". */
export function fmtCost(usd: number): string {
  if (usd <= 0) return '$0';
  if (usd < 0.01) return '<1¢';
  return `$${usd.toFixed(2)}`;
}
