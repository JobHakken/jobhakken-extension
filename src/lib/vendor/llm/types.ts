/**
 * VENDORED from @jobhakken/core (libraries/core/src/types.ts, lines 505-548), 2026-08-19.
 *
 * Why vendored rather than imported: @jobhakken/core stays a private, proprietary package (billing,
 * sync, matching algorithms — the actual business). This extension is meant to build standalone for
 * open-source contributors, so it cannot depend on a private registry. These four types are the entire
 * surface the extension's LLM code needs — no business logic, just an abstraction seam.
 *
 * TRADEOFF, stated plainly: core's own copy exists so the extension and the desktop app are
 * GUARANTEED to agree (CLAUDE.md: "don't fork them here" — written for exactly this reason). Vendoring
 * breaks that guarantee; the two copies can now drift. Low risk here specifically — this is a stable,
 * narrow interface, not the eligibility ruleset (which changes more often; see eligibility.ts's own
 * note for how to keep that one in sync manually).
 */

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
};

export type LlmCompletionRequest = {
  system?: string;
  user: string;
  model?: string;
  maxTokens?: number;
  jsonSchema?: unknown;
  temperature?: number;
  callType?: string;
};

export type LlmCompletionResult = {
  text: string;
  usage: LlmUsage;
};

export interface LlmClient {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
