import { describe, it, expect } from 'vitest';
import { normaliseSitePath, SitePathError } from '../../src/util/site-path.js';

describe('normaliseSitePath', () => {
  it('returns a simple relative path unchanged after URL-decoding', () => {
    expect(normaliseSitePath('dir/index.html')).toBe('dir/index.html');
    expect(normaliseSitePath('dir%2Findex.html')).toBe('dir/index.html');
  });

  it('strips a leading slash', () => {
    expect(normaliseSitePath('/dir/x.html')).toBe('dir/x.html');
  });

  it('treats an empty or "/" path as the root marker ""', () => {
    expect(normaliseSitePath('')).toBe('');
    expect(normaliseSitePath('/')).toBe('');
  });

  it('rejects literal traversal segments', () => {
    expect(() => normaliseSitePath('../etc/passwd')).toThrow(SitePathError);
    expect(() => normaliseSitePath('a/../b')).toThrow(SitePathError);
  });

  it('rejects URL-encoded traversal segments', () => {
    expect(() => normaliseSitePath('%2E%2E/etc/passwd')).toThrow(SitePathError);
    expect(() => normaliseSitePath('a/%2e%2e/b')).toThrow(SitePathError);
    expect(() => normaliseSitePath('a/%2E./b')).toThrow(SitePathError);
  });

  it('rejects backslash segments (Windows-style traversal)', () => {
    expect(() => normaliseSitePath('a\\..\\b')).toThrow(SitePathError);
  });

  it('rejects NUL bytes', () => {
    expect(() => normaliseSitePath('a/\x00b')).toThrow(SitePathError);
  });
});
