/**
 * VENDORED from @jobhakken/core (libraries/core/src/llm/localLlmClient.ts), 2026-08-19 — see src/lib/vendor/llm/types.ts for why.
 */

import { LlmClient, LlmCompletionRequest, LlmCompletionResult, LlmUsage } from './types.js';
import { computeCostUsd } from './pricing.js';

/**
 * BYO-key LlmClient implementation (ADR-003). Talks to any OpenAI-compatible
 * chat-completions endpoint (OpenRouter / OpenAI / Azure / local) over `fetch` —
 * no SDK dependency, so it stays portable (Node, Deno, and later the extension's
 * service worker all have `fetch`).
 *
 * Door-open rules honored here:
 *  - the API key is read via an injected `getApiKey` provider, never hardcoded;
 *  - the usage meter (`onUsage`) fires on every call, even in BYO-key mode, so
 *    accounting is consistent when the managed tier lands;
 *  - every call is metered with a real dollar cost (see pricing.ts), not $0.
 *
 * Robustness: each request is wrapped in a ~60s AbortController timeout and retried
 * with exponential backoff on transient failures (HTTP 429/5xx, timeouts, network
 * errors). Completions default to `temperature: 0` so scoring/keyword/exclusion are
 * deterministic (callers can override per request).
 *
 * This is the only place a provider is called directly; feature code depends on the
 * `LlmClient` interface, not on this class.
 */
export type LocalLlmConfig = {
  /** OpenAI-compatible base URL, no trailing slash. Default: OpenRouter. */
  baseUrl?: string;
  /** Model id used when a request doesn't specify one. */
  defaultModel: string;
  /** Returns the user's API key (from settings). Never hardcode the source. */
  getApiKey: () => string | null | undefined | Promise<string | null | undefined>;
  /** Metering hook — fires on every successful call (also in BYO mode). */
  onUsage?: (usage: LlmUsage & { model: string }) => void;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms (AbortController). Default 60s. */
  timeoutMs?: number;
  /** Retry attempts after the first try on transient failures. Default 2 (3 total). */
  maxRetries?: number;
  /** Base backoff delay in ms; grows exponentially (base, 2×, 4×…). Default 500. */
  retryBaseDelayMs?: number;
  /** Injectable sleep for tests (defaults to setTimeout-based delay). */
  sleepImpl?: (ms: number) => Promise<void>;
};

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;

export class LocalLlmClient implements LlmClient {
  constructor(private readonly config: LocalLlmConfig) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const apiKey = await this.config.getApiKey();
    if (!apiKey) {
      throw new Error('No LLM API key configured. Add your API key in Settings (or start a managed subscription).');
    }

    const baseUrl = (this.config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = request.model || this.config.defaultModel;
    const doFetch = this.config.fetchImpl ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = this.config.maxRetries ?? DEFAULT_MAX_RETRIES;
    const baseDelay = this.config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_MS;
    const sleep = this.config.sleepImpl ?? defaultSleep;

    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    messages.push({ role: 'user', content: request.user });

    const body: Record<string, unknown> = { model, messages };
    // Forward the feature's call type to the managed proxy as jh_call_type — it selects the free-tier
    // quota category (résumé-AI vs other-AI) and drives cost attribution. Harmless for BYO endpoints
    // (an OpenAI-compatible server ignores unknown top-level fields).
    if (request.callType) body.jh_call_type = request.callType;
    if (typeof request.maxTokens === 'number') body.max_tokens = request.maxTokens;
    // Deterministic by default (temperature 0) so scoring/keyword/exclusion don't
    // drift between runs; writing features can override with request.temperature.
    body.temperature = typeof request.temperature === 'number' ? request.temperature : 0;
    // Ask for JSON when the caller wants structured output (prompt must also instruct it).
    if (request.jsonSchema) body.response_format = { type: 'json_object' };
    const payload = JSON.stringify(body);

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.fetchWithTimeout(
          doFetch,
          `${baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: payload,
          },
          timeoutMs,
        );

        if (!res.ok) {
          const detail = await safeText(res);
          const err = new Error(`LLM request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
          // Retry only transient server-side / rate-limit statuses.
          if (isRetryableStatus(res.status) && attempt < maxRetries) {
            lastError = err;
            await sleep(backoffDelay(baseDelay, attempt));
            continue;
          }
          throw err;
        }

        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        const choice = json.choices?.[0];
        const text = choice?.message?.content ?? '';
        const inputTokens = json.usage?.prompt_tokens ?? 0;
        const outputTokens = json.usage?.completion_tokens ?? 0;
        const { costUsd } = computeCostUsd(model, inputTokens, outputTokens);
        const usage: LlmUsage = { inputTokens, outputTokens, costUsd };

        this.config.onUsage?.({ ...usage, model });
        return { text, usage };
      } catch (error) {
        // Timeouts and network errors are transient — retry within budget.
        if (isTransientError(error) && attempt < maxRetries) {
          lastError = error;
          await sleep(backoffDelay(baseDelay, attempt));
          continue;
        }
        throw error;
      }
    }

    // Exhausted retries on a transient failure.
    throw lastError instanceof Error ? lastError : new Error('LLM request failed after retries');
  }

  private async fetchWithTimeout(
    doFetch: typeof fetch,
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`LLM request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** True for a retryable transport-level error (timeout / abort / network). */
function isTransientError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name;
  if (name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|network|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function backoffDelay(baseMs: number, attempt: number): number {
  return baseMs * 2 ** attempt;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(res: Response): Promise<string | null> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return null;
  }
}
