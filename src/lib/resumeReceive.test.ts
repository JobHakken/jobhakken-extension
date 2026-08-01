import { describe, expect, it } from '@jest/globals';

import { acceptsResumeSchema, resumeDataToProfile } from './resumeReceive';

describe('acceptsResumeSchema (#107 — contract is numeric schemaVersion, ADR-0005)', () => {
  it('accepts the numeric schemaVersion 5 the site now sends', () => {
    expect(acceptsResumeSchema({ schemaVersion: 5 })).toBe(true);
  });
  it('still accepts the legacy string tag during rollout', () => {
    expect(acceptsResumeSchema({ schema: 'reactive-resume-v5' })).toBe(true);
  });
  it('rejects other/absent versions', () => {
    expect(acceptsResumeSchema({ schemaVersion: 4 })).toBe(false);
    expect(acceptsResumeSchema({ schemaVersion: '5' })).toBe(false); // must be numeric, not a string
    expect(acceptsResumeSchema({})).toBe(false);
  });
});

/** A minimal reactive-resume-v5 payload (anonymous data — Jordan Rivera / example.com). */
const v5 = {
  basics: {
    name: 'Jordan Rivera',
    email: 'jordan.rivera@example.com',
    phone: '+1 555 0100',
    location: 'Austin, TX',
    url: { url: 'https://jordanrivera.example.com', label: 'Portfolio' },
  },
  sections: {
    profiles: {
      items: [
        { network: 'LinkedIn', username: 'jrivera', website: { url: 'https://linkedin.com/in/jrivera' } },
        { network: 'GitHub', username: 'jrivera', website: { url: 'https://github.com/jrivera' } },
      ],
    },
    experience: {
      items: [
        {
          company: 'Globex',
          position: 'Staff Engineer',
          period: '2021 — Present',
          description: 'Led the platform team.',
        },
        { company: 'Initech', position: 'Senior Engineer', period: '2018 — 2021', description: 'Payments.' },
      ],
    },
    education: {
      items: [{ school: 'Example State University', degree: 'B.S.', area: 'Computer Science', period: '2014 — 2018' }],
    },
  },
};

describe('resumeDataToProfile (#107 — website → extension résumé handoff)', () => {
  it('maps basics, links, experience, and education into a FullProfile', () => {
    const fp = resumeDataToProfile(v5);
    expect(fp.profile.firstName).toBe('Jordan');
    expect(fp.profile.lastName).toBe('Rivera');
    expect(fp.profile.fullName).toBe('Jordan Rivera');
    expect(fp.profile.email).toBe('jordan.rivera@example.com');
    expect(fp.profile.phone).toBe('+1 555 0100');
    expect(fp.profile.city).toBe('Austin, TX');
    expect(fp.profile.website).toBe('https://jordanrivera.example.com');
    expect(fp.profile.linkedin).toBe('https://linkedin.com/in/jrivera');
    expect(fp.profile.github).toBe('https://github.com/jrivera');
    // currentTitle/currentCompany come from the first (most recent) experience.
    expect(fp.profile.currentTitle).toBe('Staff Engineer');
    expect(fp.profile.currentCompany).toBe('Globex');

    expect(fp.experience).toHaveLength(2);
    expect(fp.experience?.[0]).toMatchObject({ company: 'Globex', position: 'Staff Engineer' });
    expect(fp.education).toHaveLength(1);
    expect(fp.education?.[0]).toMatchObject({ school: 'Example State University', fieldOfStudy: 'Computer Science' });
  });

  it('splits a single-word name into firstName only', () => {
    const fp = resumeDataToProfile({ basics: { name: 'Cher', email: 'cher@example.com' } });
    expect(fp.profile.firstName).toBe('Cher');
    expect(fp.profile.lastName).toBeUndefined();
  });

  it('handles missing/empty sections without throwing', () => {
    const fp = resumeDataToProfile({ basics: { name: 'A B', email: 'ab@example.com' }, sections: {} });
    expect(fp.experience).toEqual([]);
    expect(fp.education).toEqual([]);
  });

  it('rejects a non-object payload', () => {
    expect(() => resumeDataToProfile(null)).toThrow(/not an object/i);
    expect(() => resumeDataToProfile('resume')).toThrow(/not an object/i);
  });

  it('rejects a payload with nothing résumé-shaped (so it can never blank the profile)', () => {
    expect(() => resumeDataToProfile({ foo: 'bar', basics: {} })).toThrow(/does not look like a résumé/i);
  });

  it('ignores non-string field values defensively', () => {
    const fp = resumeDataToProfile({
      basics: { name: 'Jordan Rivera', email: 'jordan@example.com', phone: 12345 },
      sections: { experience: { items: 'not-an-array' } },
    });
    expect(fp.profile.phone).toBeUndefined();
    expect(fp.experience).toEqual([]);
  });
});
