import { describe, expect, it } from '@jest/globals';
import { bucket } from './telemetryClient';

describe('bucket', () => {
  it('buckets counts into coarse, non-identifying ranges', () => {
    expect(bucket(0)).toBe('0');
    expect(bucket(-1)).toBe('0');
    expect(bucket(1)).toBe('1-5');
    expect(bucket(5)).toBe('1-5');
    expect(bucket(6)).toBe('6-15');
    expect(bucket(15)).toBe('6-15');
    expect(bucket(16)).toBe('16+');
    expect(bucket(999)).toBe('16+');
  });
});
