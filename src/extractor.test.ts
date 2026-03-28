// Tests for spec extractor: validation, structure checks, unsupported scenario rejection

import { describe, it, expect } from 'vitest';
import { validateNormalizedScenario } from './extractor.js';
import type { NormalizedScenario } from './types.js';

function makeValidScenario(overrides: Partial<NormalizedScenario> = {}): NormalizedScenario {
  return {
    name: 'Test Scenario',
    description: 'A test scenario',
    agentCount: 5,
    roles: [],
    resources: [{ name: 'pool', description: 'Shared pool', initialValue: 1000, min: 0, max: 1000 }],
    actions: [{
      name: 'extract',
      description: 'Extract from pool',
      params: [{ name: 'amount', type: 'number', min: 0, max: 100, description: 'Amount to extract' }],
      allowedRoles: [],
    }],
    observationModel: [
      { name: 'poolLevel', type: 'number', visibility: 'public', description: 'Current pool level' },
      { name: 'myWealth', type: 'number', visibility: 'private', description: 'My wealth' },
    ],
    rules: [{ description: 'Pool cannot go negative', type: 'hard' }],
    ambiguities: [],
    collapseCondition: 'Pool drops below 0',
    successCondition: 'Pool survives all rounds',
    scenarioClass: 'single-action-simultaneous',
    ...overrides,
  };
}

describe('validateNormalizedScenario', () => {
  it('accepts a valid scenario', () => {
    const result = validateNormalizedScenario(makeValidScenario());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null input', () => {
    const result = validateNormalizedScenario(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('non-null object');
  });

  it('rejects array input', () => {
    const result = validateNormalizedScenario([]);
    expect(result.valid).toBe(false);
  });

  it('rejects missing name', () => {
    const s = makeValidScenario();
    (s as Record<string, unknown>).name = '';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('name'))).toBe(true);
  });

  it('rejects agentCount below 2', () => {
    const s = makeValidScenario({ agentCount: 1 });
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('agentCount'))).toBe(true);
  });

  it('rejects agentCount above 20', () => {
    const s = makeValidScenario({ agentCount: 21 });
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('agentCount'))).toBe(true);
  });

  it('rejects non-integer agentCount', () => {
    const s = makeValidScenario({ agentCount: 5.5 });
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
  });

  // --- Unsupported scenario classes ---

  it('rejects sequential scenario class', () => {
    const s = makeValidScenario() as Record<string, unknown>;
    s.scenarioClass = 'sequential';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unsupported scenario class'))).toBe(true);
  });

  it('rejects phased scenario class', () => {
    const s = makeValidScenario() as Record<string, unknown>;
    s.scenarioClass = 'phased';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unsupported'))).toBe(true);
  });

  it('rejects negotiation scenario class', () => {
    const s = makeValidScenario() as Record<string, unknown>;
    s.scenarioClass = 'negotiation';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unsupported'))).toBe(true);
  });

  it('rejects multi-action scenario class', () => {
    const s = makeValidScenario() as Record<string, unknown>;
    s.scenarioClass = 'multi-action';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unsupported'))).toBe(true);
  });

  it('rejects unknown scenario class', () => {
    const s = makeValidScenario() as Record<string, unknown>;
    s.scenarioClass = 'something-weird';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unknown scenario class'))).toBe(true);
  });

  // --- Action schema validation ---

  it('rejects empty actions array', () => {
    const s = makeValidScenario({ actions: [] });
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('actions'))).toBe(true);
  });

  it('validates action param types', () => {
    const s = makeValidScenario();
    (s.actions[0].params[0] as Record<string, unknown>).type = 'invalid';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('params[0].type'))).toBe(true);
  });

  it('rejects non-number min on numeric param', () => {
    const s = makeValidScenario();
    (s.actions[0].params[0] as Record<string, unknown>).min = 'not-a-number';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('min'))).toBe(true);
  });

  it('accepts action with allowedRoles', () => {
    const s = makeValidScenario({
      roles: [{ name: 'harvester', description: 'Harvests resources' }],
    });
    s.actions[0].allowedRoles = ['harvester'];
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(true);
  });

  it('rejects action allowedRoles that reference unknown roles', () => {
    const s = makeValidScenario();
    s.actions[0].allowedRoles = ['harvester'];
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('unknown role'))).toBe(true);
  });

  // --- Observation model validation ---

  it('rejects empty observationModel', () => {
    const s = makeValidScenario({ observationModel: [] });
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('observationModel'))).toBe(true);
  });

  it('validates observation field types', () => {
    const s = makeValidScenario();
    (s.observationModel[0] as Record<string, unknown>).type = 'invalid';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('observationModel[0].type'))).toBe(true);
  });

  it('validates observation visibility', () => {
    const s = makeValidScenario();
    (s.observationModel[0] as Record<string, unknown>).visibility = 'shared';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('visibility'))).toBe(true);
  });

  it('accepts number[] observation type', () => {
    const s = makeValidScenario();
    s.observationModel.push({ name: 'history', type: 'number[]', visibility: 'public', description: 'History' });
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(true);
  });

  it('rejects reserved internal observation field names', () => {
    const s = makeValidScenario();
    s.observationModel[0].name = '_role';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('reserved name'))).toBe(true);
  });

  // --- Rule validation ---

  it('rejects invalid rule type', () => {
    const s = makeValidScenario();
    (s.rules[0] as Record<string, unknown>).type = 'critical';
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('rules[0].type'))).toBe(true);
  });

  // --- Ambiguity validation ---

  it('validates ambiguity severity', () => {
    const s = makeValidScenario({
      ambiguities: [{
        field: 'agentCount',
        description: 'Not specified',
        severity: 'critical' as 'high',  // invalid severity
        resolution: 'Defaulted to 5',
      }],
    });
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('severity'))).toBe(true);
  });

  it('accepts valid ambiguities', () => {
    const s = makeValidScenario({
      ambiguities: [{
        field: 'regeneration',
        description: 'Rate not specified',
        severity: 'medium',
        resolution: 'Assumed 10%',
      }],
    });
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(true);
  });

  // --- Resource validation ---

  it('rejects resource without initialValue', () => {
    const s = makeValidScenario();
    delete (s.resources[0] as Record<string, unknown>).initialValue;
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('initialValue'))).toBe(true);
  });

  // --- Edge cases ---

  it('accepts minimal valid scenario (no roles, no ambiguities)', () => {
    const s = makeValidScenario({ roles: [], ambiguities: [] });
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(true);
  });

  it('accepts scenario with multiple actions', () => {
    const s = makeValidScenario();
    s.actions.push({
      name: 'donate',
      description: 'Give to another agent',
      params: [{ name: 'amount', type: 'number', min: 0, max: 50, description: 'Donation amount' }],
      allowedRoles: [],
    });
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(true);
  });

  it('accepts boolean and string param types', () => {
    const s = makeValidScenario();
    s.actions[0].params.push(
      { name: 'cooperate', type: 'boolean', description: 'Whether to cooperate' },
      { name: 'target', type: 'string', description: 'Target agent name' },
    );
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const result = validateNormalizedScenario({
      name: '',
      description: '',
      agentCount: 0,
      roles: 'not-array',
      resources: 'not-array',
      actions: [],
      observationModel: [],
      rules: 'not-array',
      ambiguities: 'not-array',
      collapseCondition: '',
      successCondition: '',
      scenarioClass: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(5);
  });

  it('rejects overly long descriptive text', () => {
    const s = makeValidScenario({ description: 'x'.repeat(1001) });
    const result = validateNormalizedScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('maximum length'))).toBe(true);
  });
});
