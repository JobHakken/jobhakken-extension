import { describe, expect, it, jest } from '@jest/globals';

import { buildAnswerMessages, buildCandidateContext, draftAnswers, parseAnswers } from './aiClient';

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
