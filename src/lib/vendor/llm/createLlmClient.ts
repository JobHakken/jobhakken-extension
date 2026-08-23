/**
 * VENDORED from @jobhakken/core (libraries/core/src/llm/createLlmClient.ts), 2026-08-19 — see src/lib/vendor/llm/types.ts for why.
 */

import { LlmClient } from './types.js';
import { AnthropicLlmClient } from './anthropicLlmClient.js';
import { GeminiLlmClient } from './geminiLlmClient.js';
import { NativeLlmConfig } from './httpRetry.js';
import { LocalLlmClient } from './localLlmClient.js';
import { LlmAdapter } from './providers.js';

/**
 * Factory for the BYOK adapters (issue #389). Given a provider's `adapter` and a
 * single config shape, returns the matching `LlmClient` behind the seam:
 *  - `openai`    → LocalLlmClient (OpenAI-compatible: OpenRouter/OpenAI/Ollama/LM
 *                  Studio/GLM/Codex/custom)
 *  - `anthropic` → AnthropicLlmClient (native Messages API)
 *  - `gemini`    → GeminiLlmClient (native generateContent)
 *
 * All three share `NativeLlmConfig` (baseUrl / defaultModel / getApiKey / onUsage /
 * fetchImpl + retry knobs), so callers wire them identically. Feature code depends
 * only on `LlmClient`; this is the one place that knows which provider is behind it.
 */
export function createLlmClient(adapter: LlmAdapter, config: NativeLlmConfig): LlmClient {
  switch (adapter) {
    case 'anthropic':
      return new AnthropicLlmClient(config);
    case 'gemini':
      return new GeminiLlmClient(config);
    case 'openai':
    default:
      return new LocalLlmClient(config);
  }
}
