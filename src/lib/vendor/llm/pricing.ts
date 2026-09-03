/**
 * VENDORED from @jobhakken/core (libraries/core/src/llm/pricing.ts — a PUBLIC price table (OpenRouter-published rates), used only for local cost estimation, never for billing the user), 2026-08-19 — see src/lib/vendor/llm/types.ts for why.
 */

/**
 * Per-model price table + cost computation for the LLM seam.
 *
 * Metering (`onUsage`) fires on every call, but the token→dollars conversion lives
 * here so both the BYO-key `LocalLlmClient` (now) and a future managed client can
 * record real spend into `ai_api_cost` (see incrementAiUsage). Without this the
 * cost was always $0.
 *
 * Prices are USD per 1,000,000 tokens (input / output), as published by the
 * providers behind OpenRouter. They are approximate — providers change pricing and
 * OpenRouter adds a small markup — and are used only for local cost *estimation*,
 * never for billing the user. An unknown model prices at $0 (with a one-time note),
 * so a missing entry degrades gracefully instead of throwing.
 *
 * Pure logic (aside from the warn-once note) — safe for the Deno edge runtime.
 */

export type ModelPrice = {
  /** USD per 1M input (prompt) tokens. */
  inputPerM: number;
  /** USD per 1M output (completion) tokens. */
  outputPerM: number;
};

/**
 * Common OpenRouter model slugs → price. Keep slugs lowercase; lookup normalizes.
 * Anthropic entries mirror first-party per-MTok pricing (OpenRouter passes it
 * through, plus markup). Extend as new default models are adopted.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // DeepSeek (the app default is deepseek/deepseek-v4-flash) — cheapest tier.
  'deepseek/deepseek-v4-flash': { inputPerM: 0.1, outputPerM: 0.3 },
  'deepseek/deepseek-chat': { inputPerM: 0.28, outputPerM: 0.88 },
  'deepseek/deepseek-r1': { inputPerM: 0.55, outputPerM: 2.19 },

  // OpenAI
  'openai/gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'openai/gpt-4o': { inputPerM: 2.5, outputPerM: 10 },
  'openai/gpt-5-mini': { inputPerM: 0.25, outputPerM: 2 },

  // Google
  'google/gemini-2.0-flash-001': { inputPerM: 0.1, outputPerM: 0.4 },
  'google/gemini-2.5-flash': { inputPerM: 0.3, outputPerM: 2.5 },

  // Meta
  'meta-llama/llama-3.3-70b-instruct': { inputPerM: 0.12, outputPerM: 0.3 },

  // Anthropic (first-party per-MTok list price)
  'anthropic/claude-haiku-4.5': { inputPerM: 1, outputPerM: 5 },
  'anthropic/claude-sonnet-4.6': { inputPerM: 3, outputPerM: 15 },
  'anthropic/claude-opus-4.8': { inputPerM: 5, outputPerM: 25 },

  // Native provider model ids (BYOK direct adapters — #389). These are the bare
  // slugs the Anthropic / Gemini / OpenAI APIs use (no "provider/" prefix), so
  // native-adapter calls meter a real cost instead of $0. Approximate list prices.
  'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
  'claude-sonnet-4-5': { inputPerM: 3, outputPerM: 15 },
  'claude-opus-4-1': { inputPerM: 15, outputPerM: 75 },
  'gemini-2.5-flash': { inputPerM: 0.3, outputPerM: 2.5 },
  'gemini-2.0-flash': { inputPerM: 0.1, outputPerM: 0.4 },
  'gemini-2.5-pro': { inputPerM: 1.25, outputPerM: 10 },
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10 },
};

const notedUnknownModels = new Set<string>();

/** Look up a model's price, tolerating case + an accidental provider-less slug. */
export function lookupModelPrice(model: string): ModelPrice | null {
  if (!model) return null;
  const key = model.trim().toLowerCase();
  return MODEL_PRICES[key] ?? null;
}

/**
 * Cost of one call in USD. Returns `priced: false` (and $0) for models absent from
 * the table so metering never blocks on a missing entry — the first miss per model
 * emits a one-time console note so gaps are visible without spamming.
 */
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): { costUsd: number; priced: boolean } {
  const price = lookupModelPrice(model);
  if (!price) {
    if (model && !notedUnknownModels.has(model)) {
      notedUnknownModels.add(model);
      console.warn(
        `[llm/pricing] no price entry for model "${model}"; recording $0 cost. Add it to MODEL_PRICES for accurate accounting.`,
      );
    }
    return { costUsd: 0, priced: false };
  }
  const costUsd =
    (Math.max(0, inputTokens) / 1_000_000) * price.inputPerM +
    (Math.max(0, outputTokens) / 1_000_000) * price.outputPerM;
  return { costUsd, priced: true };
}
