/**
 * VENDORED from @jobhakken/core (libraries/core/src/llm/providers.ts), 2026-08-19 — see src/lib/vendor/llm/types.ts for why.
 */

/**
 * BYOK provider registry (issue #389). A pure, framework-agnostic list of presets
 * the desktop + extension BYO-settings UIs render as a picker: choosing a provider
 * prefills its `baseUrl` + `defaultModel` and tells the form which adapter to build
 * and whether an API key is even required (`apiKeyless` for local runtimes).
 *
 * Most providers speak the OpenAI chat-completions protocol, so they share the
 * `openai` adapter and differ only by base URL (Ollama / LM Studio / GLM / Codex /
 * OpenAI / OpenRouter). Anthropic and Gemini are not OpenAI-compatible and get
 * native adapters (see anthropicLlmClient.ts / geminiLlmClient.ts). "Custom" lets a
 * user point at any OpenAI-compatible endpoint by hand.
 *
 * No electron/fs/network here — this is data + a lookup helper, safe for the Deno
 * edge graph and the extension service worker alike.
 */

/** Which concrete LlmClient implementation a provider maps to. */
export type LlmAdapter = 'openai' | 'anthropic' | 'gemini';

export type LlmProvider = {
  /** Stable id persisted in settings + emitted as (safe) telemetry. */
  id: string;
  /** Human label for the picker. */
  label: string;
  /** Concrete adapter to build for this provider. */
  adapter: LlmAdapter;
  /** Default base URL (omitted for "custom", where the user supplies it). */
  baseUrl?: string;
  /** Model id prefilled when the user hasn't overridden it. */
  defaultModel: string;
  /** True for local runtimes that need no API key (Ollama / LM Studio / Codex). */
  apiKeyless?: boolean;
  /** Field label for the key input (varies by provider vocabulary). */
  apiKeyLabel?: string;
  /** Where to get a key / read setup docs. */
  docsUrl?: string;
  /** One-line hint shown under the picker. */
  hint?: string;
};

/** Default provider id — OpenRouter, the app's historical BYOK default. */
export const DEFAULT_PROVIDER_ID = 'openrouter';

export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    adapter: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-v4-flash',
    apiKeyLabel: 'OpenRouter API key',
    docsUrl: 'https://openrouter.ai/keys',
    hint: 'One key, hundreds of models. The default.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    adapter: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    apiKeyLabel: 'OpenAI API key',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    adapter: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-haiku-4-5',
    apiKeyLabel: 'Anthropic API key',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    label: 'Gemini (Google)',
    adapter: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.5-flash',
    apiKeyLabel: 'Google AI (Gemini) API key',
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    adapter: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    apiKeyless: true,
    hint: 'Runs models on your machine — no key needed.',
    docsUrl: 'https://ollama.com',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    adapter: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    apiKeyless: true,
    hint: 'Runs models on your machine — no key needed.',
    docsUrl: 'https://lmstudio.ai',
  },
  {
    id: 'glm',
    label: 'GLM / Zhipu',
    adapter: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    apiKeyLabel: 'Zhipu API key',
    docsUrl: 'https://open.bigmodel.cn',
  },
  {
    id: 'codex',
    label: 'Codex (local app-server)',
    adapter: 'openai',
    baseUrl: 'http://localhost:1455/v1',
    defaultModel: 'gpt-5-codex',
    apiKeyless: true,
    hint: 'Local OpenAI-compatible app-server.',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    adapter: 'openai',
    // No baseUrl — the user enters their own endpoint.
    defaultModel: '',
    apiKeyLabel: 'API key',
    hint: 'Point at any OpenAI-compatible endpoint.',
  },
];

/** Look up a provider preset by id; falls back to the default (OpenRouter). */
export function getProvider(id?: string | null): LlmProvider {
  const found = id ? LLM_PROVIDERS.find((p) => p.id === id) : undefined;
  return found ?? getDefaultProvider();
}

export function getDefaultProvider(): LlmProvider {
  // The default id is always present; the `!` is safe (asserted by the providers test).
  return LLM_PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER_ID)!;
}
