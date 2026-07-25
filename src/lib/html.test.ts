import { describe, expect, it } from '@jest/globals';
import { escapeHtml } from './html';

describe('escapeHtml', () => {
  it('neutralizes an XSS payload', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes all HTML-significant characters', () => {
    expect(escapeHtml(`Jordan "JR" O'Rivera & <b>`)).toBe('Jordan &quot;JR&quot; O&#39;Rivera &amp; &lt;b&gt;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Jordan Rivera')).toBe('Jordan Rivera');
  });
});
