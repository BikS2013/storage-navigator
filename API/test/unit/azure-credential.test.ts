import { describe, it, expect } from 'vitest';
import { DefaultAzureCredential } from '@azure/identity';
import { getAzureCredential, _resetAzureCredential } from '../../src/azure/credential.js';

describe('getAzureCredential', () => {
  it('returns a DefaultAzureCredential instance', () => {
    _resetAzureCredential();
    const c = getAzureCredential();
    expect(c).toBeInstanceOf(DefaultAzureCredential);
  });

  it('returns the same instance on repeated calls', () => {
    _resetAzureCredential();
    const a = getAzureCredential();
    const b = getAzureCredential();
    expect(a).toBe(b);
  });
});
