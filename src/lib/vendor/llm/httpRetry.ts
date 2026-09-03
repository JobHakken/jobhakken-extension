/**
 * VENDORED from @jobhakken/core (libraries/core/src/llm/httpRetry.ts), 2026-08-19 — see src/lib/vendor/llm/types.ts for why.
 */

/**
 * Shared HTTP transport for the LlmClient adapters: a per-request AbortController
 * timeout plus exponential-backoff retry on transient failures (HTTP 429/5xx,
 * timeouts, network errors). Extracted so the native Anthropic / Gemini adapters
 * reuse the exact robustness contract `LocalLlmClient` established, instead of
 * each copy drifting. Pure (fetch-only) — safe for Node, Deno, and service workers.
 *
 * `fetchImpl` / `sleepImpl` are injectable for deterministic tests. The retry loop
 * mirrors `LocalLlmClient`: a non-ok response with a retryable status is retried
 * within budget; a non-retryable status throws immediately with the body detail;
 * transient transport errors (abort / network) are retried too.
 */

/** Transport knobs shared by every LlmClient adapter (timeout + retry + injection). */
export type HttpRetryConfig = {
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

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_BASE_MS = 500;

/**
 * Config shared by every native LlmClient adapter (Anthropic, Gemini, and the
 * OpenAI-compatible LocalLlmClient). Mirrors `LocalLlmConfig` so the factory can
 * dispatch on a single shape. The key is always read via `getApiKey` (never
 * hardcoded); `onUsage` fires on every successful call, even in BYO-key mode.
 */
export type NativeLlmConfig = HttpRetryConfig & {
  /** Provider base URL, no trailing slash. Adapter supplies its own default. */
  baseUrl?: string;
  /** Model id used when a request doesn't specify one. */
  defaultModel: string;
  /** Returns the user's API key (from settings). Never hardcode the source. */
  getApiKey: () => string | null | undefined | Promise<string | null | undefined>;
  /** Metering hook — fires on every successful call (also in BYO mode). */
  onUsage?: (usage: { inputTokens: number; outputTokens: number; costUsd?: number; model: string }) => void;
};

/**
 * POST (or any method) with timeout + retry, returning a response that is `res.ok`.
 * `errorLabel` prefixes the thrown message so callers get provider-specific errors
 * (e.g. "Anthropic request failed (HTTP 429)…").
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  config: HttpRetryConfig,
  errorLabel = 'LLM',
): Promise<Response> {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_MS;
  const sleep = config.sleepImpl ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchWithTimeout(doFetch, url, init, timeoutMs);
      if (!res.ok) {
        const detail = await safeText(res);
        const err = new Error(`${errorLabel} request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
        if (isRetryableStatus(res.status) && attempt < maxRetries) {
          lastError = err;
          await sleep(backoffDelay(baseDelay, attempt));
          continue;
        }
        throw err;
      }
      return res;
    } catch (error) {
      if (isTransientError(error) && attempt < maxRetries) {
        lastError = error;
        await sleep(backoffDelay(baseDelay, attempt));
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${errorLabel} request failed after retries`);
}

async function fetchWithTimeout(
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
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** True for a retryable transport-level error (timeout / abort / network). */
export function isTransientError(error: unknown): boolean {
  if (!error) return false;
  const name = (error as { name?: string }).name;
  if (name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|network|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message);
}

export function isRetryableStatus(status: number): boolean {
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
