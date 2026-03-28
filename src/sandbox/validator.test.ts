import { describe, it, expect } from 'vitest';
import { validateStrategy, validateEconomyModule, validateDecision } from './validator.js';
import type { NormalizedScenario } from '../types.js';

describe('validateStrategy', () => {
  const validCode = `function greedy(state) {
  return state.maxExtraction;
}`;

  it('accepts a valid strategy', () => {
    const result = validateStrategy(validCode);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing function signature', () => {
    const result = validateStrategy('const x = 5; return x;');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('function'))).toBe(true);
  });

  it('rejects missing return statement', () => {
    const result = validateStrategy('function test(state) { state.maxExtraction; }');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('return'))).toBe(true);
  });

  it('rejects extra top-level code after the function', () => {
    const result = validateStrategy('function test(state) { return 0; } while (true) {}');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exactly one function declaration'))).toBe(true);
  });

  // Blocked patterns
  const blockedCases: [string, string][] = [
    ['function t(state) { return globalThis.x; }', 'globalThis'],
    ['function t(state) { return this.x; }', 'this'],
    ['function t(state) { setTimeout(() => {}, 0); return 0; }', 'setTimeout'],
    ['function t(state) { setInterval(() => {}, 0); return 0; }', 'setInterval'],
    ['function t(state) { return new Promise(r => r(0)); }', 'Promise'],
    ['function t(state) { return eval("1"); }', 'eval'],
    ['function t(state) { return process.env.X; }', 'process'],
    ['function t(state) { return require("fs"); }', 'require'],
    ['function t(state) { return fetch("http://x"); }', 'fetch'],
    ['function t(state) { console.log(1); return 0; }', 'console'],
    ['function t(state) { return Function("return 1")(); }', 'Function'],
    ['async function t(state) { return 0; }', 'async'],
    ['function t(state) { return Math.random(); }', 'Math.random'],
    ['function t(state) { return Date.now(); }', 'Date'],
  ];

  for (const [code, pattern] of blockedCases) {
    it(`blocks ${pattern}`, () => {
      const result = validateStrategy(code);
      expect(result.valid).toBe(false);
    });
  }

  it('allows Math operations', () => {
    const code = 'function t(state) { return Math.min(state.sustainableShare, state.maxExtraction); }';
    const result = validateStrategy(code);
    expect(result.valid).toBe(true);
  });

  it('allows array methods', () => {
    const code = 'function t(state) { return state.myHistory.reduce((a, b) => a + b, 0); }';
    const result = validateStrategy(code);
    expect(result.valid).toBe(true);
  });

  it('allows state access', () => {
    const code = `function t(state) {
  const share = state.poolLevel * state.regenerationRate / state.agentCount;
  return Math.min(share, state.maxExtraction);
}`;
    const result = validateStrategy(code);
    expect(result.valid).toBe(true);
  });

  it('does not false-positive on blocked words in strings', () => {
    const code = `function t(state) {
  var x = "this is a process with setTimeout";
  return state.maxExtraction;
}`;
    const result = validateStrategy(code);
    expect(result.valid).toBe(true);
  });

  it('rejects bracket access to constructor gadgets', () => {
    const code = `function t(state) {
  return []['filter']['constructor']('return 1')();
}`;
    const result = validateStrategy(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('constructor bracket access'))).toBe(true);
  });

  it('rejects string-concatenated property gadgets', () => {
    const code = `function t(state) {
  return []['filter']['constr' + 'uctor']('return 1')();
}`;
    const result = validateStrategy(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('string-concatenated property access'))).toBe(true);
  });
});

// --- Economy Module Validation ---

describe('validateEconomyModule', () => {
  const validEconomy = `
export function initState(scenario) {
  const pool = scenario.resources[0].initialValue;
  return { pool, round: 0, agentWealth: new Array(scenario.agentCount).fill(0) };
}

export function tick(state, decisions, scenario) {
  return state;
}

export function extractMetrics(state, scenario) {
  return { poolLevel: state.pool };
}

export function checkInvariants(state, scenario) {
  return [];
}

export function isCollapsed(state, scenario) {
  return state.pool < 0.01;
}

export function getObservations(state, agentIndex, scenario) {
  return { poolLevel: state.pool, myWealth: state.agentWealth[agentIndex] };
}
`.trim();

  it('accepts a valid economy module with all 6 exports', () => {
    const result = validateEconomyModule(validEconomy);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects economy missing initState', () => {
    const code = validEconomy.replace(/export function initState[\s\S]*?\n\}/, '');
    const result = validateEconomyModule(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('initState'))).toBe(true);
  });

  it('rejects economy missing tick', () => {
    const code = validEconomy.replace(/export function tick[\s\S]*?\n\}/, '');
    const result = validateEconomyModule(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('tick'))).toBe(true);
  });

  it('rejects economy missing getObservations', () => {
    const code = validEconomy.replace(/export function getObservations[\s\S]*?\n\}/, '');
    const result = validateEconomyModule(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('getObservations'))).toBe(true);
  });

  it('rejects module-scope let declarations', () => {
    const code = `let counter = 0;\n${validEconomy}`;
    const result = validateEconomyModule(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Mutable module-scope'))).toBe(true);
  });

  it('rejects module-scope var declarations', () => {
    const code = `var state = {};\n${validEconomy}`;
    const result = validateEconomyModule(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Mutable module-scope'))).toBe(true);
  });

  it('allows module-scope const declarations', () => {
    const code = `const MAX = 1000;\n${validEconomy}`;
    const result = validateEconomyModule(code);
    expect(result.valid).toBe(true);
  });

  it('rejects code exceeding 20KB limit', () => {
    const code = validEconomy + '\n' + '// '.repeat(10000);
    const result = validateEconomyModule(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('byte limit'))).toBe(true);
  });

  it('applies same blocked patterns as strategy (e.g. process, eval)', () => {
    const code = validEconomy.replace('return state;', 'process.exit(1); return state;');
    const result = validateEconomyModule(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('process'))).toBe(true);
  });

  it('does NOT reject export keyword (required for economy modules)', () => {
    const result = validateEconomyModule(validEconomy);
    expect(result.errors.some(e => e.includes('export not allowed'))).toBe(false);
  });
});

// --- Decision Validation ---

function makeScenario(): NormalizedScenario {
  return {
    name: 'Test',
    description: 'Test',
    agentCount: 5,
    roles: [{ name: 'harvester', description: 'Harvests' }],
    resources: [{ name: 'pool', description: 'Pool', initialValue: 1000 }],
    actions: [{
      name: 'extract',
      description: 'Extract from pool',
      params: [
        { name: 'amount', type: 'number', min: 0, max: 200, description: 'Amount' },
      ],
      allowedRoles: ['harvester'],
    }, {
      name: 'vote',
      description: 'Vote on policy',
      params: [
        { name: 'support', type: 'boolean', description: 'Support the policy' },
      ],
      allowedRoles: [],
    }],
    observationModel: [{ name: 'poolLevel', type: 'number', visibility: 'public', description: 'Pool' }],
    rules: [],
    ambiguities: [],
    collapseCondition: 'Pool < 0',
    successCondition: 'Pool survives',
    scenarioClass: 'single-action-simultaneous',
  };
}

describe('validateDecision', () => {
  it('accepts a valid decision', () => {
    const result = validateDecision({ action: 'extract', params: { amount: 100 } }, makeScenario(), 0, 'harvester');
    expect(result.valid).toBe(true);
  });

  it('rejects null decision', () => {
    const result = validateDecision(null, makeScenario(), 0);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('non-null object');
  });

  it('rejects unknown action name', () => {
    const result = validateDecision({ action: 'steal', params: {} }, makeScenario(), 0);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Unknown action');
  });

  it('rejects out-of-range numeric param (too high)', () => {
    const result = validateDecision({ action: 'extract', params: { amount: 300 } }, makeScenario(), 0, 'harvester');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exceeds maximum'))).toBe(true);
  });

  it('rejects out-of-range numeric param (too low)', () => {
    const result = validateDecision({ action: 'extract', params: { amount: -5 } }, makeScenario(), 0, 'harvester');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('below minimum'))).toBe(true);
  });

  it('rejects wrong param type', () => {
    const result = validateDecision({ action: 'extract', params: { amount: 'lots' } }, makeScenario(), 0, 'harvester');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('finite number'))).toBe(true);
  });

  it('rejects NaN param', () => {
    const result = validateDecision({ action: 'extract', params: { amount: NaN } }, makeScenario(), 0, 'harvester');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('finite number'))).toBe(true);
  });

  it('rejects missing param', () => {
    const result = validateDecision({ action: 'extract', params: {} }, makeScenario(), 0, 'harvester');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Missing param'))).toBe(true);
  });

  it('rejects role permission violation', () => {
    const result = validateDecision({ action: 'extract', params: { amount: 100 } }, makeScenario(), 0, 'regulator');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('not allowed to perform'))).toBe(true);
  });

  it('allows action with empty allowedRoles for any role', () => {
    const result = validateDecision({ action: 'vote', params: { support: true } }, makeScenario(), 0, 'anyone');
    expect(result.valid).toBe(true);
  });

  it('validates boolean param type', () => {
    const result = validateDecision({ action: 'vote', params: { support: 'yes' } }, makeScenario(), 0);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('must be a boolean'))).toBe(true);
  });
});
