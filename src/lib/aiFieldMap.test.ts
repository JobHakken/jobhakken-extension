import { describe, expect, it } from '@jest/globals';

import { buildPrompt, candidateKeys, mapFieldsWithAi, parseMap, type OpenQuestion } from './aiFieldMap';

const QS: OpenQuestion[] = [
  { id: 1, label: "What's the name you'd prefer us to use throughout the interview process?" },
  { id: 2, label: 'Are you subject to any employment agreements or post-employment restrictions?' },
  { id: 3, label: 'What is your current country of residence?' },
];
const KEYS = ['preferredName', 'country', 'email'] as const;

describe('candidateKeys', () => {
  it('offers only keys the user actually filled in', () => {
    expect(candidateKeys({ preferredName: 'Jordan', email: '', country: '  ' })).toEqual(['preferredName']);
  });
});

describe('buildPrompt', () => {
  it('sends labels and profile KEY NAMES — never a profile value', () => {
    const p = buildPrompt(QS, [...KEYS]);
    expect(p).toContain('preferredName');
    expect(p).toContain("What's the name you'd prefer");
    // the privacy guarantee of this design
    expect(p).not.toContain('Jordan');
    expect(p).not.toContain('@example.com');
  });
});

describe('parseMap — guardrails', () => {
  it('accepts a valid mapping', () => {
    expect(parseMap({ map: { 1: 'preferredName', 3: 'country' } }, QS, [...KEYS])).toEqual({
      1: 'preferredName',
      3: 'country',
    });
  });

  it('drops a hallucinated profile key', () => {
    expect(parseMap({ map: { 1: 'favouriteColour' } }, QS, [...KEYS])).toEqual({});
  });

  it('drops an unknown field id', () => {
    expect(parseMap({ map: { 99: 'country' } }, QS, [...KEYS])).toEqual({});
  });

  it('NEVER maps a legal attestation, even when the model insists', () => {
    // Q2 is an employment-agreement question — no stored field honestly answers it.
    expect(parseMap({ map: { 2: 'currentCompany' } }, QS, ['currentCompany'])).toEqual({});
  });

  it('never maps consent / criminal-history / accommodation questions', () => {
    const risky: OpenQuestion[] = [
      { id: 1, label: 'Do you consent to a background check?' },
      { id: 2, label: 'Have you ever been convicted of a felony?' },
      { id: 3, label: 'Do you require an accommodation for the interview?' },
      { id: 4, label: 'I certify the information above is accurate' },
    ];
    expect(parseMap({ map: { 1: 'country', 2: 'country', 3: 'country', 4: 'country' } }, risky, ['country'])).toEqual(
      {},
    );
  });

  it('tolerates junk from the model', () => {
    for (const junk of [null, undefined, {}, { map: 'nope' }, { map: { a: 1 } }]) {
      expect(parseMap(junk, QS, [...KEYS])).toEqual({});
    }
  });
});

describe('mapFieldsWithAi', () => {
  const cfg = { apiKey: 'k' };
  const reply = (obj: unknown): typeof fetch =>
    (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }),
      }) as unknown as Response) as unknown as typeof fetch;

  it('maps the questions our rules missed', async () => {
    const out = await mapFieldsWithAi(
      cfg,
      QS,
      { preferredName: 'Jordan', country: 'United States' },
      reply({ map: { 1: 'preferredName', 3: 'country' } }),
    );
    expect(out).toEqual({ 1: 'preferredName', 3: 'country' });
  });

  it('returns {} when the profile has nothing to offer', async () => {
    expect(await mapFieldsWithAi(cfg, QS, {}, reply({ map: { 1: 'preferredName' } }))).toEqual({});
  });

  it('never throws — a failing model must not break autofill', async () => {
    const dead = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(await mapFieldsWithAi(cfg, QS, { preferredName: 'Jordan' }, dead)).toEqual({});
  });
});
