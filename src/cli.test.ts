import { describe, it, expect } from 'vitest';
import { parseAndValidateArgs } from './cli.js';

describe('parseAndValidateArgs', () => {
  it('returns defaults when no args are provided', () => {
    const flags = parseAndValidateArgs([]);
    expect(flags.rounds).toBe(50);
    expect(flags.pool).toBe(1000);
    expect(flags.regen).toBe(0.1);
    expect(flags.maxExtract).toBe(0.2);
    expect(flags.verbose).toBe(false);
    expect(flags.fixtures).toBe(false);
  });

  it('rejects pool values above the safe arithmetic limit', () => {
    expect(() => parseAndValidateArgs(['--pool', '100000.01']))
      .toThrow(/Invalid --pool value/);
  });

  it('rejects pool values with more than two decimal places', () => {
    expect(() => parseAndValidateArgs(['--pool', '10.001']))
      .toThrow(/at most 2 decimal places/);
  });

  it('rejects invalid round bounds', () => {
    expect(() => parseAndValidateArgs(['--rounds', '0']))
      .toThrow(/Invalid --rounds value/);
  });
});
