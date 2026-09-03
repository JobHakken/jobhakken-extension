/**
 * VENDORED from @jobhakken/core (libraries/core/src/llm/anthropicLlmClient.ts), 2026-08-19 — see src/lib/vendor/llm/types.ts for why.
 */

import { LlmClient, LlmCompletionRequest, LlmCompletionResult, LlmUsage } from './types.js';
import { fetchWithRetry, NativeLlmConfig } from './httpRetry.js';
import { computeCostUsd } from './pricing.js';

/**
 * Native Anthropic (Claude) `LlmClient` — talks to the Messages API directly over
 * `fetch`, no SDK. Anthropic is NOT OpenAI-compatible (different endpoint, auth
 * header, and request/response shape), so BYOK users get a true "no middleman"
 * path instead of routing through OpenRouter (see issue #389).
 *
 * Door-open rules (same as LocalLlmClient): the key is read via an injected
 * `getApiKey`, never hardcoded; `onUsage` fires on every successful call with a
 * best-effort dollar cost (see pricing.ts); every request is wrapped in the shared
 * timeout + exponential-backoff retry (httpRetry.ts). Runs in the desktop main
 * process, so the browser CORS restriction on `x-api-key` does not apply here.
 *
 * JSON output: Anthropic has no `response_format: json_object`, so when a request
 * asks for structured JSON we append a terse JSON-only instruction to the system
 * prompt (the feature prompt already describes the schema — mirroring the intent
 * of LocalLlmClient's `response_format` hint). This reliably yields raw JSON that
 * the callers' `parseJson` tolerates.
 */

export type AnthropicLlmConfig = NativeLlmConfig;

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
// Anthropic requires max_tokens; use a generous default when the caller omits one.
const DEFAULT_MAX_TOKENS = 4096;
const JSON_ONLY_INSTRUCTION =
  'Respond with only a single valid JSON value. Do not include any prose, explanation, or markdown code fences.';

export class AnthropicLlmClient implements LlmClient {
  constructor(private readonly config: AnthropicLlmConfig) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const apiKey = await this.config.getApiKey();
    if (!apiKey) {
      throw new Error(
        'No Anthropic API key configured. Add your Claude API key in Settings (or start a managed subscription).',
      );
    }

    const baseUrl = (this.config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = request.model || this.config.defaultModel;

    let system = request.system;
    if (request.jsonSchema) {
      system = system ? `${system}\n\n${JSON_ONLY_INSTRUCTION}` : JSON_ONLY_INSTRUCTION;
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: typeof request.maxTokens === 'number' ? request.maxTokens : DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: request.user }],
      // Deterministic by default (see LocalLlmClient) — callers override for writing features.
      temperature: typeof request.temperature === 'number' ? request.temperature : 0,
    };
    if (system) body.system = system;

    const res = await fetchWithRetry(
      `${baseUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      },
      this.config,
      'Anthropic',
    );

    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    // Concatenate every text block (Claude may split output across blocks).
    const text = (json.content ?? [])
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
    const inputTokens = json.usage?.input_tokens ?? 0;
    const outputTokens = json.usage?.output_tokens ?? 0;
    const { costUsd } = computeCostUsd(model, inputTokens, outputTokens);
    const usage: LlmUsage = { inputTokens, outputTokens, costUsd };

    this.config.onUsage?.({ ...usage, model });
    return { text, usage };
  }
}
