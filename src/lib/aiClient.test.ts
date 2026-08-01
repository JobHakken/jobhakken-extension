import { describe, expect, it, jest } from '@jest/globals';

import {
  buildAnswerMessages,
  buildCandidateContext,
  draftAnswers,
  parseAnswers,
  parseResumeJson,
  parseResumeToProfile,
} from './aiClient';

describe('buildCandidateContext', () => {
  it('summarizes the profile without inventing anything', () => {
    const ctx = buildCandidateContext(
      { fullName: 'Jordan Rivera', currentTitle: 'Engineer', currentCompany: 'Globex', yearsExperience: '6' },
      [{ title: 'Engineer', company: 'Globex', summary: 'Backend platform' }],
      [{ degree: 'BS', fieldOfStudy: 'CS', school: 'UT Austin' }],
    );
    expect(ctx).toContain('Jordan Rivera');
    expect(ctx).toContain('Engineer at Globex');
    expect(ctx).toContain('BS, CS, UT Austin');
  });
});

describe('buildAnswerMessages', () => {
  it('asks for a JSON array of exactly N answers and numbers the questions', () => {
    const msgs = buildAnswerMessages('brief', { title: 'SWE', company: 'Acme' }, ['Why us?', 'A project?']);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toMatch(/1\. Why us\?/);
    expect(msgs[1].content).toMatch(/2\. A project\?/);
    expect(msgs[1].content).toMatch(/exactly 2 answer/);
  });
});

describe('parseAnswers', () => {
  it('parses a plain JSON array', () => {
    expect(parseAnswers('["a","b"]', 2)).toEqual(['a', 'b']);
  });
  it('tolerates code fences and stray prose', () => {
    expect(parseAnswers('Here you go:\n```json\n["x","y"]\n```', 2)).toEqual(['x', 'y']);
  });
  it('returns [] on non-JSON', () => {
    expect(parseAnswers('sorry, I cannot', 2)).toEqual([]);
  });
});

describe('draftAnswers', () => {
  const cfg = { apiKey: 'k', baseUrl: 'https://x/v1', model: 'm' };
  const job = { title: 'SWE' };

  it('makes ONE batched call for all questions and returns aligned answers + usage', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '["ans1","ans2","ans3"]' } }],
        usage: { prompt_tokens: 800, completion_tokens: 90 },
      }),
    })) as unknown as typeof fetch;
    const r = await draftAnswers(cfg, 'brief', job, ['q1', 'q2', 'q3'], fetchMock);
    expect((fetchMock as unknown as jest.Mock).mock.calls.length).toBe(1); // batched, not one-per-question
    expect(r.answers).toEqual(['ans1', 'ans2', 'ans3']);
    expect(r.usage).toEqual({ promptTokens: 800, completionTokens: 90 });
  });

  it('sends the key as a Bearer header to the configured base', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenAuth = (init.headers as Record<string, string>).authorization;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '["a"]' } }] }) };
    }) as unknown as typeof fetch;
    await draftAnswers(cfg, 'brief', job, ['q1'], fetchMock);
    expect(seenUrl).toBe('https://x/v1/chat/completions');
    expect(seenAuth).toBe('Bearer k');
  });

  it('throws with the provider status on an error response', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'bad key',
    })) as unknown as typeof fetch;
    await expect(draftAnswers(cfg, 'brief', job, ['q1'], fetchMock)).rejects.toThrow(/401/);
  });

  it('no questions → no call', async () => {
    const fetchMock = jest.fn() as unknown as typeof fetch;
    const r = await draftAnswers(cfg, 'brief', job, [], fetchMock);
    expect(r.answers).toEqual([]);
    expect((fetchMock as unknown as jest.Mock).mock.calls.length).toBe(0);
  });
});

describe('draftAnswers — native adapters (#115 phase 2)', () => {
  const job = { title: 'SWE' };

  it('routes Anthropic through core with the MV3 browser-CORS header injected', async () => {
    let url = '';
    let browserHeader: string | null = null;
    const fetchMock = jest.fn(async (u: string, init: RequestInit) => {
      url = String(u);
      browserHeader = new Headers(init?.headers).get('anthropic-dangerous-direct-browser-access');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: 'text', text: '["Anthropic answer"]' }],
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      };
    }) as unknown as typeof fetch;
    const r = await draftAnswers({ apiKey: 'ak', provider: 'anthropic' }, 'brief', job, ['q1'], fetchMock);
    expect(url).toMatch(/api\.anthropic\.com\/v1\/messages$/);
    expect(browserHeader).toBe('true'); // the browser can't call Anthropic x-api-key without this
    expect(r.answers).toEqual(['Anthropic answer']);
    expect(r.usage).toEqual({ promptTokens: 10, completionTokens: 4 });
  });

  it('routes Gemini through core (?key= URL, no Anthropic header)', async () => {
    let url = '';
    let browserHeader: string | null = null;
    const fetchMock = jest.fn(async (u: string, init: RequestInit) => {
      url = String(u);
      browserHeader = new Headers(init?.headers).get('anthropic-dangerous-direct-browser-access');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '["Gemini answer"]' }] } }],
          usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 },
        }),
      };
    }) as unknown as typeof fetch;
    const r = await draftAnswers({ apiKey: 'gk', provider: 'gemini' }, 'brief', job, ['q1'], fetchMock);
    expect(url).toMatch(/generativelanguage\.googleapis\.com\/.*:generateContent\?key=gk/);
    expect(browserHeader).toBeNull(); // Anthropic header must NOT leak onto other providers
    expect(r.answers).toEqual(['Gemini answer']);
  });

  it('an absent/unknown provider stays on the OpenAI-compatible path', async () => {
    let url = '';
    const fetchMock = jest.fn(async (u: string) => {
      url = String(u);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '["ok"]' } }] }) };
    }) as unknown as typeof fetch;
    await draftAnswers({ apiKey: 'k', baseUrl: 'https://x/v1' }, 'brief', job, ['q1'], fetchMock);
    expect(url).toBe('https://x/v1/chat/completions');
  });
});

describe('parseResumeJson', () => {
  it('extracts + whitelists profile fields and coerces the arrays', () => {
    const r = parseResumeJson(
      '```json\n{"profile":{"fullName":"Jordan Rivera","email":"j@example.com","currentTitle":"Engineer","salaryExpectation":"999999","ssn":"leak"},' +
        '"experience":[{"position":"Engineer","company":"Globex"}],"education":[{"degree":"BS","school":"UT"}]}\n```',
    );
    expect(r.profile.fullName).toBe('Jordan Rivera');
    expect(r.profile.email).toBe('j@example.com');
    expect(r.profile.currentTitle).toBe('Engineer');
    expect(r.profile.salaryExpectation).toBeUndefined(); // sensitive → never accepted from a résumé
    expect((r.profile as Record<string, string>).ssn).toBeUndefined(); // unknown key dropped
    expect(r.experience).toHaveLength(1);
    expect(r.education[0].school).toBe('UT');
  });

  it('returns empty shape on non-JSON', () => {
    expect(parseResumeJson('sorry')).toEqual({ profile: {}, experience: [], education: [] });
  });
});

describe('parseResumeToProfile', () => {
  it('makes one call and returns the parsed profile + usage', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"profile":{"firstName":"Jordan"},"experience":[],"education":[]}' } }],
        usage: { prompt_tokens: 900, completion_tokens: 120 },
      }),
    })) as unknown as typeof fetch;
    const r = await parseResumeToProfile({ apiKey: 'k' }, 'Jordan Rivera — Senior Engineer at Globex…', fetchMock);
    expect((fetchMock as unknown as jest.Mock).mock.calls.length).toBe(1);
    expect(r.parsed.profile.firstName).toBe('Jordan');
    expect(r.usage).toEqual({ promptTokens: 900, completionTokens: 120 });
  });

  it('empty text → no call', async () => {
    const fetchMock = jest.fn() as unknown as typeof fetch;
    const r = await parseResumeToProfile({ apiKey: 'k' }, '   ', fetchMock);
    expect(r.parsed.profile).toEqual({});
    expect((fetchMock as unknown as jest.Mock).mock.calls.length).toBe(0);
  });
});
