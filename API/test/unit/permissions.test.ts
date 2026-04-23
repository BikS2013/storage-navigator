import { describe, it, expect } from 'vitest';
import { ROLE_VERBS, type Verb } from '../../src/rbac/permissions.js';

/**
 * Pin the role-verb matrix to the spec (Section 6, role matrix). If this
 * test fails, the implementation drifted from the design contract — fix the
 * code, not the test, unless the spec itself was updated.
 */
describe('ROLE_VERBS matrix', () => {
  it('Reader can only read', () => {
    expect([...ROLE_VERBS.Reader].sort()).toEqual<Verb[]>(['read']);
  });

  it('Writer can read, write, and delete-item but not delete-container/folder', () => {
    expect([...ROLE_VERBS.Writer].sort()).toEqual<Verb[]>(
      ['delete-item', 'read', 'write'],
    );
    expect(ROLE_VERBS.Writer.has('delete-container')).toBe(false);
    expect(ROLE_VERBS.Writer.has('delete-folder')).toBe(false);
  });

  it('Admin can do everything', () => {
    expect([...ROLE_VERBS.Admin].sort()).toEqual<Verb[]>(
      ['delete-container', 'delete-folder', 'delete-item', 'read', 'write'],
    );
  });
});
