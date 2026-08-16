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
import { createLlmClient } from '@jobhakken/core/build/llm/createLlmClient.js';
import { getProvider } from '@jobhakken/core/build/llm/providers.js';

import { hasAiHostPermission } from './hostPerms.js';

export type AiConfig = {
  apiKey: string;
  /** OpenAI-compatible base, e.g. https://openrouter.ai/api/v1 (default) or http://127.0.0.1:PORT/v1. */
  baseUrl?: string;
  /** Model id, e.g. openai/gpt-4o-mini (OpenRouter) or gpt-4o-mini (OpenAI). */
  model?: string;
  /** `@jobhakken/core` `LLM_PROVIDERS` preset id the user picked (#115). Carried for the settings UI +
   *  safe telemetry; the fetch path only needs apiKey/baseUrl/model. */
  provider?: string;
};

export type AiUsage = { promptTokens: number; completionTokens: number };
export type DraftResult = { answers: string[]; usage: AiUsage | null };

export const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

/**
 * BYOK provider hosts are OPTIONAL permissions (requested when the user saves their key). Verify we
 * hold the grant before calling out, so a missing/denied permission surfaces as a clear "grant access"
 * message instead of an opaque network failure. No-op in tests (no `chrome`) and for local endpoints.
 */
async function ensureHostAllowed(base: string): Promise<void> {
  const g = globalThis as { chrome?: { permissions?: unknown } };
  if (!g.chrome?.permissions) return; // jest / content world — skip
  if (await hasAiHostPermission(base)) return;
  let host = base;
  try {
    host = new URL(base).hostname;
  } catch {
    /* keep the raw base in the message */
  }
  throw new Error(`Grant access to ${host} in Settings → AI (your key’s provider), then try again.`);
}

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

// ── Résumé → structured profile (AI résumé-input, features plan D4) ──────────────────────────────

/** Profile keys that can be read straight off a résumé. Deliberately EXCLUDES sensitive/EEO, salary,
 * and work-authorization/visa — those are never on a résumé and must not be guessed. */
export const RESUME_PROFILE_KEYS: readonly string[] = [
  'firstName',
  'middleName',
  'lastName',
  'fullName',
  'preferredName',
  'email',
  'phone',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'zipCode',
  'country',
  'location',
  'linkedin',
  'github',
  'website',
  'twitter',
  'currentCompany',
  'currentTitle',
  'yearsExperience',
  'school',
  'degree',
  'fieldOfStudy',
  'graduationYear',
  'gpa',
];

export type ParsedResume = {
  profile: Record<string, string>;
  experience: Record<string, unknown>[];
  education: Record<string, unknown>[];
};

export function buildResumeParseMessages(resumeText: string): { role: 'system' | 'user'; content: string }[] {
  const system =
    "You extract a job candidate's profile from their résumé into strict JSON. " +
    'Use ONLY facts explicitly present in the text — never invent or infer an email, phone, degree, or dates that are not written. ' +
    'Omit any field you cannot find. Return ONLY the JSON object, no prose.';
  const user =
    'Return this shape (include only fields present):\n' +
    '{"profile":{"firstName":"","lastName":"","fullName":"","email":"","phone":"","city":"","state":"","country":"","location":"","linkedin":"","github":"","website":"","currentTitle":"","currentCompany":"","yearsExperience":""},' +
    '"experience":[{"position":"","company":"","period":"","description":""}],' +
    '"education":[{"degree":"","fieldOfStudy":"","school":"","period":""}]}\n\n' +
    `RÉSUMÉ:\n${resumeText.slice(0, 12_000)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Extract the JSON object from a model reply, whitelist profile keys, and coerce the arrays. */
export function parseResumeJson(content: string): ParsedResume {
  let text = content
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  const out: ParsedResume = { profile: {}, experience: [], education: [] };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return out;
  }
  const rawP = (obj.profile ?? {}) as Record<string, unknown>;
  for (const k of RESUME_PROFILE_KEYS) {
    const v = rawP[k];
    if (typeof v === 'string' && v.trim()) out.profile[k] = v.trim();
    else if (typeof v === 'number') out.profile[k] = String(v);
  }
  const arr = (x: unknown): Record<string, unknown>[] =>
    Array.isArray(x)
      ? x
          .filter((e) => e && typeof e === 'object')
          .slice(0, 12)
          .map((e) => e as Record<string, unknown>)
      : [];
  out.experience = arr(obj.experience);
  out.education = arr(obj.education);
  return out;
}

/** Anthropic blocks browser `x-api-key` calls unless this header is present. Core's AnthropicLlmClient
 *  omits it (built for the desktop main process, where CORS doesn't apply), so we inject it for the
 *  extension's browser context. We only wrap the Anthropic path, so it never touches other hosts. */
function withAnthropicBrowserHeader(f: typeof fetch): typeof fetch {
  return ((url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('anthropic-dangerous-direct-browser-access', 'true');
    return f(url, { ...init, headers });
  }) as typeof fetch;
}

/**
 * One adapter-aware completion (#115 phase 2). OpenAI-compatible providers use the chat-completions
 * fetch exactly as before; Anthropic + Gemini (not OpenAI-compatible) route through @jobhakken/core's
 * native, fetch-only clients — with the Anthropic browser-CORS header injected. Returns the raw text +
 * token usage; callers parse it (unchanged). The provider is read from `cfg.provider` (the picker id);
 * absent ⇒ OpenAI-compatible, so pre-#115 configs keep working.
 */
async function runChat(
  cfg: AiConfig,
  req: { system: string; user: string; maxTokens: number; temperature: number },
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ content: string; usage: AiUsage | null }> {
  const preset = cfg.provider ? getProvider(cfg.provider) : null;
  const adapter = preset?.adapter ?? 'openai';
  const base = (cfg.baseUrl || preset?.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  await ensureHostAllowed(base);

  if (adapter === 'anthropic' || adapter === 'gemini') {
    const client = createLlmClient(adapter, {
      baseUrl: cfg.baseUrl || preset?.baseUrl,
      defaultModel: cfg.model || preset?.defaultModel || DEFAULT_MODEL,
      getApiKey: () => cfg.apiKey,
      fetchImpl: adapter === 'anthropic' ? withAnthropicBrowserHeader(fetchImpl) : fetchImpl,
      timeoutMs,
    });
    const r = await client.complete({
      system: req.system,
      user: req.user,
      model: cfg.model || undefined,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
    });
    return { content: r.text, usage: { promptTokens: r.usage.inputTokens, completionTokens: r.usage.outputTokens } };
  }

  // OpenAI-compatible (OpenRouter / OpenAI / GLM / Ollama / LM Studio / Codex / custom).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        'HTTP-Referer': 'https://jobhakken.com',
        'X-Title': 'JobHakken',
      },
      body: JSON.stringify({
        model: cfg.model || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_tokens: req.maxTokens,
        temperature: req.temperature,
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
    return { content, usage };
  } finally {
    clearTimeout(timer);
  }
}

/** One call: parse a résumé (paste/upload text) into a structured profile + token usage. */
export async function parseResumeToProfile(
  cfg: AiConfig,
  resumeText: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ parsed: ParsedResume; usage: AiUsage | null }> {
  if (!cfg.apiKey) throw new Error('No AI key');
  if (!resumeText.trim()) return { parsed: { profile: {}, experience: [], education: [] }, usage: null };
  const [sys, usr] = buildResumeParseMessages(resumeText);
  const { content, usage } = await runChat(
    cfg,
    { system: sys.content, user: usr.content, maxTokens: 1600, temperature: 0.1 },
    fetchImpl,
    45_000,
  );
  return { parsed: parseResumeJson(content), usage };
}

/** One batched call to the provider. Returns drafted answers aligned to `questions` + token usage. */
/**
 * One JSON-answering chat call, for callers that want structured output rather than prose. Goes through
 * runChat so every BYOK provider (OpenAI-compatible, Anthropic, Gemini) and the optional host-permission
 * check work exactly as they do elsewhere. Throws if the model returns nothing parseable.
 */
export async function chatJson(
  cfg: AiConfig,
  system: string,
  user: string,
  fetchImpl: typeof fetch = fetch,
  maxTokens = 900,
): Promise<unknown> {
  if (!cfg.apiKey) throw new Error('No AI key');
  const { content } = await runChat(cfg, { system, user, maxTokens, temperature: 0 }, fetchImpl, 25_000);
  let text = content
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) text = text.slice(a, b + 1);
  return JSON.parse(text);
}

export async function draftAnswers(
  cfg: AiConfig,
  context: string,
  job: { title?: string; company?: string; description?: string },
  questions: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<DraftResult> {
  if (!cfg.apiKey) throw new Error('No AI key');
  if (!questions.length) return { answers: [], usage: null };
  const [sys, usr] = buildAnswerMessages(context, job, questions);
  const { content, usage } = await runChat(
    cfg,
    {
      system: sys.content,
      user: usr.content,
      maxTokens: Math.min(200 + questions.length * 220, 1600),
      temperature: 0.4,
    },
    fetchImpl,
    30_000,
  );
  return { answers: parseAnswers(content, questions.length), usage };
}
