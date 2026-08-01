import { createHash } from 'crypto';

import { describe, expect, it } from '@jest/globals';

import { hostHash, registrableDomain } from './siteDiscovery';

describe('registrableDomain — drops subdomains, keeps the ATS/registrable domain', () => {
  const cases: [string, string][] = [
    ['boards.greenhouse.io', 'greenhouse.io'],
    ['myco.wd5.myworkdayjobs.com', 'myworkdayjobs.com'], // the ATS, not the company
    ['careers.stripe.com', 'stripe.com'],
    ['jobs.lever.co', 'lever.co'],
    ['example.com', 'example.com'],
    ['localhost', 'localhost'],
    ['careers.bigco.co.uk', 'bigco.co.uk'], // multi-part suffix
    ['deep.sub.domain.example.com.au', 'example.com.au'],
    ['Careers.BIGCO.com', 'bigco.com'], // case-insensitive
    ['trailing.example.com.', 'example.com'], // trailing dot
  ];
  it.each(cases)('%s → %s', (input, expected) => {
    expect(registrableDomain(input)).toBe(expected);
  });
});

describe('hostHash — salted, truncated, non-reversible bucket', () => {
  const salt = 'build-salt';

  it('is a salted SHA-256 of the registrable domain, truncated to 16 hex chars', async () => {
    const expected = createHash('sha256').update(`${salt}:greenhouse.io`).digest('hex').slice(0, 16);
    expect(await hostHash('boards.greenhouse.io', salt)).toBe(expected);
  });

  it('buckets all subdomains of a host to the SAME hash (k-anon counting)', async () => {
    const a = await hostHash('careers.stripe.com', salt);
    const b = await hostHash('jobs.stripe.com', salt);
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it('changes with the salt (so the hash space is unguessable without the build salt)', async () => {
    expect(await hostHash('example.com', 'salt-a')).not.toBe(await hostHash('example.com', 'salt-b'));
  });

  it('returns "" with no salt (dev/CI build → reports nothing) or no host', async () => {
    expect(await hostHash('example.com', '')).toBe('');
    expect(await hostHash('', salt)).toBe('');
  });
});
