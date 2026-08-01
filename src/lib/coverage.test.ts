import { describe, expect, it } from '@jest/globals';

import type { DetectedField, FieldResult } from '@jobhakken/autofill';

import { classifyMissedField, missedFieldTypes, type MissedFieldType } from './coverage';

/** Minimal DetectedField for classification (only label/name/id/kind are read). */
const field = (over: Partial<DetectedField>): DetectedField =>
  ({ el: {} as HTMLElement, kind: 'text', label: '', name: '', id: '', signature: 's', ...over }) as DetectedField;

const res = (over: Partial<FieldResult>): FieldResult =>
  ({ field: field({}), resolution: null, value: '', status: 'unmapped', ...over }) as FieldResult;

describe('classifyMissedField — resolved key wins', () => {
  it('maps a resolved ProfileKey to its type', () => {
    expect(classifyMissedField(field({}), 'workAuthorization')).toBe('work_auth');
    expect(classifyMissedField(field({}), 'raceEthnicity')).toBe('eeo_race');
    expect(classifyMissedField(field({}), 'salaryExpectation')).toBe('salary');
    expect(classifyMissedField(field({}), 'firstName')).toBe('name');
    expect(classifyMissedField(field({}), 'coverLetter')).toBe('cover_letter');
  });
});

describe('classifyMissedField — keyword fallback (no key)', () => {
  const cases: [string, MissedFieldType][] = [
    ['Cover letter', 'cover_letter'],
    ['Are you legally authorized to work in the US?', 'work_auth'],
    ['Will you now or in the future require sponsorship?', 'sponsorship'],
    ['Desired salary expectation', 'salary'],
    ['What is your notice period?', 'notice_period'],
    ['Gender identity', 'eeo_gender'],
    ['Veteran status', 'eeo_veteran'],
    ['Do you have a disability?', 'eeo_disability'],
    ['LinkedIn profile URL', 'linkedin'],
    ['Upload your résumé', 'file_upload'],
  ];
  it.each(cases)('classifies %j → %s', (label, expected) => {
    expect(classifyMissedField(field({ label }))).toBe(expected);
  });

  it('reads name/id too, not just the label', () => {
    expect(classifyMissedField(field({ label: '', name: 'candidate_gender', id: '' }))).toBe('eeo_gender');
  });
});

describe('classifyMissedField — structural fallback + drop', () => {
  it('an un-keyworded combobox is a custom_dropdown', () => {
    expect(classifyMissedField(field({ label: 'Select an option', kind: 'combobox' }))).toBe('custom_dropdown');
  });
  it('returns null for anything unclassifiable (dropped, never "other")', () => {
    expect(classifyMissedField(field({ label: 'Favorite color', kind: 'text' }))).toBeNull();
  });
});

describe('missedFieldTypes — over a fill report', () => {
  it('collects distinct sorted types from non-filled fields only', () => {
    const results: FieldResult[] = [
      res({ status: 'filled', field: field({ label: 'First name' }) }), // filled → ignored
      res({ status: 'review', resolution: { source: 'ai', confidence: 0.5, key: 'salaryExpectation' } }),
      res({ status: 'unmapped', field: field({ label: 'Gender' }) }),
      res({ status: 'unmapped', field: field({ label: 'Gender identity' }) }), // dup type → collapsed
      res({ status: 'unmapped', field: field({ label: 'Favorite color' }) }), // unclassifiable → dropped
    ];
    expect(missedFieldTypes(results)).toEqual(['eeo_gender', 'salary']);
  });

  it('returns [] when everything filled', () => {
    expect(missedFieldTypes([res({ status: 'filled' }), res({ status: 'filled' })])).toEqual([]);
  });
});
