import { describe, expect, it } from '@jest/globals';

import { mergeH1bRows } from './h1bLookup';

// name \t cases \t median \t wMin \t wMax \t role:cases;role:cases  (rows sorted by name)
const NAMES = ['amazon com services', 'amazon web services', 'google', 'zzz other'];
const REST = [
  '10000\t150000\t40000\t900000\tSoftware Developers:8000;Managers:1200',
  '6000\t165000\t50000\t999996\tSoftware Developers:3000;Data Scientists:900',
  '5000\t195000\t96000\t2000000\tSoftware Developers:3500;Research Scientists:200',
  '3\t100000\t100000\t100000\tNurse:3',
];

describe('mergeH1bRows', () => {
  it('sums a brand across its word-prefix legal entities (amazon → both AWS + services)', () => {
    const d = mergeH1bRows(NAMES, REST, 'amazon');
    expect(d?.filings).toBe(16000); // 10000 + 6000
    // case-weighted median: (150000*10000 + 165000*6000) / 16000 = 155625 → rounded to $1k
    expect(d?.wageMedian).toBe(156000);
    expect(d?.wageMin).toBe(40000);
    expect(d?.wageMax).toBe(999996);
    // roles merged + summed across entities, top 3 by filings
    expect(d?.roles[0]).toEqual({ title: 'Software Developers', filings: 11000 });
  });

  it('exact single-company match', () => {
    expect(mergeH1bRows(NAMES, REST, 'google')?.filings).toBe(5000);
  });

  it('word-boundary only — "amazon" must NOT match a hypothetical "amazonbasics"', () => {
    const names = ['amazonbasics'];
    const rest = ['9\t100000\t100000\t100000\tX:9'];
    expect(mergeH1bRows(names, rest, 'amazon')).toBeNull();
  });

  it('returns null for unknown company / empty inputs', () => {
    expect(mergeH1bRows(NAMES, REST, 'unknownco')).toBeNull();
    expect(mergeH1bRows([], [], 'amazon')).toBeNull();
    expect(mergeH1bRows(NAMES, REST, '')).toBeNull();
  });

  it('caps roles at 3', () => {
    const d = mergeH1bRows(NAMES, REST, 'amazon');
    expect(d?.roles.length).toBeLessThanOrEqual(3);
  });
});
