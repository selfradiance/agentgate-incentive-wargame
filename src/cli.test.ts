import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { parseAndValidateArgs, formatScenarioSummary, confirmScenario } from './cli.js';
import type { NormalizedScenario } from './types.js';

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

  it('treats --runs= form as explicitly set in fixtures mode', () => {
    expect(() => parseAndValidateArgs(['--fixtures', '--runs=2']))
      .toThrow(/mutually exclusive/);
  });
});

// --- Scenario Confirmation Gate ---

function makeScenario(overrides: Partial<NormalizedScenario> = {}): NormalizedScenario {
  return {
    name: 'Test Scenario',
    description: 'A test scenario for validation',
    agentCount: 5,
    roles: [{ name: 'harvester', description: 'Harvests resources' }],
    resources: [{ name: 'pool', description: 'Shared pool', initialValue: 1000, min: 0, max: 1000 }],
    actions: [{
      name: 'extract',
      description: 'Extract from pool',
      params: [{ name: 'amount', type: 'number', min: 0, max: 200, description: 'Amount' }],
      allowedRoles: ['harvester'],
    }],
    observationModel: [
      { name: 'poolLevel', type: 'number', visibility: 'public', description: 'Pool level' },
      { name: 'myWealth', type: 'number', visibility: 'private', description: 'My wealth' },
    ],
    rules: [
      { description: 'Pool cannot go negative', type: 'hard' },
      { description: 'Prefer sustainable extraction', type: 'soft' },
    ],
    ambiguities: [
      { field: 'regen', description: 'Rate unclear', severity: 'medium', resolution: 'Assumed 10%' },
    ],
    collapseCondition: 'Pool drops below 0',
    successCondition: 'Pool survives all rounds',
    scenarioClass: 'single-action-simultaneous',
    ...overrides,
  };
}

describe('formatScenarioSummary', () => {
  it('includes scenario name, description, and agent count', () => {
    const summary = formatScenarioSummary(makeScenario());
    expect(summary).toContain('Test Scenario');
    expect(summary).toContain('A test scenario');
    expect(summary).toContain('Agents: 5');
  });

  it('includes roles when present', () => {
    const summary = formatScenarioSummary(makeScenario());
    expect(summary).toContain('harvester');
  });

  it('includes resources with bounds', () => {
    const summary = formatScenarioSummary(makeScenario());
    expect(summary).toContain('pool');
    expect(summary).toContain('initial: 1000');
  });

  it('includes actions with params and role permissions', () => {
    const summary = formatScenarioSummary(makeScenario());
    expect(summary).toContain('extract');
    expect(summary).toContain('roles: harvester');
    expect(summary).toContain('amount: number');
    expect(summary).toContain('[0..200]');
  });

  it('includes observations with visibility', () => {
    const summary = formatScenarioSummary(makeScenario());
    expect(summary).toContain('poolLevel: number (public)');
    expect(summary).toContain('myWealth: number (private)');
  });

  it('includes rules with type markers', () => {
    const summary = formatScenarioSummary(makeScenario());
    expect(summary).toContain('[HARD]');
    expect(summary).toContain('[SOFT]');
  });

  it('highlights ambiguities by severity', () => {
    const summary = formatScenarioSummary(makeScenario());
    expect(summary).toContain('[MEDIUM]');
    expect(summary).toContain('Rate unclear');
    expect(summary).toContain('Resolution: Assumed 10%');
  });

  it('omits roles section when no roles', () => {
    const summary = formatScenarioSummary(makeScenario({ roles: [] }));
    expect(summary).not.toContain('Roles:');
  });

  it('omits ambiguities section when none', () => {
    const summary = formatScenarioSummary(makeScenario({ ambiguities: [] }));
    expect(summary).not.toContain('Ambiguities');
  });
});

describe('confirmScenario', () => {
  it('returns true with autoYes', async () => {
    const output = new Writable({ write(_c, _e, cb) { cb(); } });
    const result = await confirmScenario(makeScenario(), { autoYes: true, output });
    expect(result).toBe(true);
  });

  it('returns true when user types y', async () => {
    const input = new Readable({ read() { this.push('y\n'); this.push(null); } });
    const output = new Writable({ write(_c, _e, cb) { cb(); } });
    const result = await confirmScenario(makeScenario(), { input, output });
    expect(result).toBe(true);
  });

  it('returns true when user types yes', async () => {
    const input = new Readable({ read() { this.push('yes\n'); this.push(null); } });
    const output = new Writable({ write(_c, _e, cb) { cb(); } });
    const result = await confirmScenario(makeScenario(), { input, output });
    expect(result).toBe(true);
  });

  it('returns false when user types n', async () => {
    const input = new Readable({ read() { this.push('n\n'); this.push(null); } });
    const output = new Writable({ write(_c, _e, cb) { cb(); } });
    const result = await confirmScenario(makeScenario(), { input, output });
    expect(result).toBe(false);
  });

  it('returns false when user types anything else', async () => {
    const input = new Readable({ read() { this.push('maybe\n'); this.push(null); } });
    const output = new Writable({ write(_c, _e, cb) { cb(); } });
    const result = await confirmScenario(makeScenario(), { input, output });
    expect(result).toBe(false);
  });
});
