/**
 * VENDORED from @jobhakken/core (libraries/core/src/llm/geminiLlmClient.ts), 2026-08-19 — see src/lib/vendor/llm/types.ts for why.
 */

import { LlmClient, LlmCompletionRequest, LlmCompletionResult, LlmUsage } from './types.js';
import { fetchWithRetry, NativeLlmConfig } from './httpRetry.js';
import { computeCostUsd } from './pricing.js';

/**
 * Native Google Gemini `LlmClient` — talks to the Generative Language API
 * (`generateContent`) directly over `fetch`, no SDK. Gemini is NOT OpenAI-compatible
 * (different endpoint, key-as-query-param auth, and request/response shape), so BYOK
 * users get a true "no middleman" path instead of routing through OpenRouter (#389).
 *
 * Door-open rules (same as LocalLlmClient): the key is read via an injected
 * `getApiKey`, never hardcoded; `onUsage` fires on every successful call with a
 * best-effort dollar cost (see pricing.ts); every request is wrapped in the shared
 * timeout + exponential-backoff retry (httpRetry.ts).
 *
 * JSON output: Gemini supports `responseMimeType: 'application/json'`, and a
 * `responseSchema` when the caller passes an object schema (a boolean `jsonSchema`
 * flag just switches on the mime type). The key is sent as the `?key=` query param
 * per the API contract.
 */

export type GeminiLlmConfig = NativeLlmConfig;

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const API_VERSION = 'v1beta';

export class GeminiLlmClient implements LlmClient {
  constructor(private readonly config: GeminiLlmConfig) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const apiKey = await this.config.getApiKey();
    if (!apiKey) {
      throw new Error(
        'No Gemini API key configured. Add your Google AI (Gemini) API key in Settings (or start a managed subscription).',
      );
    }

    const baseUrl = (this.config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = request.model || this.config.defaultModel;

    const generationConfig: Record<string, unknown> = {
      temperature: typeof request.temperature === 'number' ? request.temperature : 0,
    };
    if (typeof request.maxTokens === 'number') generationConfig.maxOutputTokens = request.maxTokens;
    if (request.jsonSchema) {
      generationConfig.responseMimeType = 'application/json';
      // Only a real object schema maps to Gemini's responseSchema; a boolean flag
      // (jsonSchema: true) just requests JSON without constraining the shape.
      if (isPlainObject(request.jsonSchema)) {
        generationConfig.responseSchema = request.jsonSchema;
      }
    }

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: request.user }] }],
      generationConfig,
    };
    if (request.system) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }

    // The API key rides in the query string; keep it out of logs by never logging URLs.
    const url = `${baseUrl}/${API_VERSION}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      this.config,
      'Gemini',
    );

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
    const inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
    const { costUsd } = computeCostUsd(model, inputTokens, outputTokens);
    const usage: LlmUsage = { inputTokens, outputTokens, costUsd };

    this.config.onUsage?.({ ...usage, model });
    return { text, usage };
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
