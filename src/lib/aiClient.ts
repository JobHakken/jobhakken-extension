/**
 * Standalone AI client — lets the extension draft application answers WITHOUT the desktop app,
 * calling the user's own LLM provider directly (BYO key). OpenAI-compatible Chat Completions, so it
 * works with OpenRouter (default), OpenAI, Together, Groq, or any compatible endpoint.
 *
 * SECURITY (ADR-0009): this runs in the BACKGROUND service worker only. The API key is read from
 * `chrome.storage.session` (memory-only, wiped on browser close) and never enters a page/content
 * world, is never logged, and never transits a JobHakken server. BYO calls emit ZERO telemetry.
 *
 * COST: all questions on a form are drafted in ONE call (résumé/job context sent once), not one call
 * per question — a 4–6× token reduction on multi-essay forms. Output is capped.
 */

export type AiConfig = {
  apiKey: string;
  /** OpenAI-compatible base, e.g. https://openrouter.ai/api/v1 (default) or http://127.0.0.1:PORT/v1. */
  baseUrl?: string;
  /** Model id, e.g. openai/gpt-4o-mini (OpenRouter) or gpt-4o-mini (OpenAI). */
  model?: string;
};

export type AiUsage = { promptTokens: number; completionTokens: number };
export type DraftResult = { answers: string[]; usage: AiUsage | null };

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

/** A compact, honest candidate brief built from the structured profile — the model may use ONLY this. */
export function buildCandidateContext(
  profile: Record<string, unknown>,
  experience: unknown[] = [],
  education: unknown[] = [],
): string {
  const p = profile as Record<string, string | undefined>;
  const lines: string[] = [];
  const name = p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' ');
  if (name) lines.push(`Name: ${name}`);
  if (p.currentTitle || p.currentCompany)
    lines.push(`Current role: ${[p.currentTitle, p.currentCompany].filter(Boolean).join(' at ')}`);
  if (p.yearsExperience) lines.push(`Years of experience: ${p.yearsExperience}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  const exp = (experience as Array<Record<string, string>>)
    .slice(0, 4)
    .map((e) => `- ${[e.title, e.company].filter(Boolean).join(' at ')}${e.summary ? `: ${e.summary}` : ''}`)
    .join('\n');
  if (exp) lines.push(`Experience:\n${exp}`);
  const edu = (education as Array<Record<string, string>>)
    .slice(0, 3)
    .map((e) => `- ${[e.degree, e.fieldOfStudy, e.school].filter(Boolean).join(', ')}`)
    .join('\n');
  if (edu) lines.push(`Education:\n${edu}`);
  return lines.join('\n');
}

/** OpenAI-compatible Chat Completions messages that ask for a strict JSON array of answers. */
export function buildAnswerMessages(
  context: string,
  job: { title?: string; company?: string; description?: string },
  questions: string[],
): { role: 'system' | 'user'; content: string }[] {
  const system =
    'You help a job candidate draft honest, concise answers to job-application questions. ' +
    'Use ONLY the candidate brief — never invent employers, degrees, credentials, or metrics not present. ' +
    'Each answer is 2–4 sentences, first person, specific, no preamble. ' +
    'Return ONLY a JSON array of strings, one answer per question, in the same order. No prose, no keys.';
  const jobBlock = [
    job.title ? `Role: ${job.title}` : '',
    job.company ? `Company: ${job.company}` : '',
    job.description ? `Job description:\n${job.description.slice(0, 3500)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const qBlock = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
  const user = [
    `CANDIDATE BRIEF\n${context}`,
    jobBlock ? `JOB\n${jobBlock}` : '',
    `QUESTIONS\n${qBlock}`,
    `Return a JSON array of exactly ${questions.length} answer string(s).`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Extract a JSON array of strings from a model reply, tolerating code fences / stray prose. */
export function parseAnswers(content: string, n: number): string[] {
  let text = content
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    const arr = JSON.parse(text);
    if (Array.isArray(arr)) return arr.slice(0, n).map((x) => (typeof x === 'string' ? x : String(x ?? '')));
  } catch {
    /* fall through */
  }
  return [];
}

/** One batched call to the provider. Returns drafted answers aligned to `questions` + token usage. */
export async function draftAnswers(
  cfg: AiConfig,
  context: string,
  job: { title?: string; company?: string; description?: string },
  questions: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<DraftResult> {
  if (!cfg.apiKey) throw new Error('No AI key');
  if (!questions.length) return { answers: [], usage: null };
  const base = (cfg.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        // OpenRouter attribution headers (harmless elsewhere).
        'HTTP-Referer': 'https://jobhakken.com',
        'X-Title': 'JobHakken',
      },
      body: JSON.stringify({
        model: cfg.model || DEFAULT_MODEL,
        messages: buildAnswerMessages(context, job, questions),
        max_tokens: Math.min(200 + questions.length * 220, 1600),
        temperature: 0.4,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI ${res.status}: ${body.slice(0, 120)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    const usage = json.usage
      ? { promptTokens: json.usage.prompt_tokens ?? 0, completionTokens: json.usage.completion_tokens ?? 0 }
      : null;
    return { answers: parseAnswers(content, questions.length), usage };
  } finally {
    clearTimeout(timer);
  }
}
