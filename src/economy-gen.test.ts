// Tests for economy generator — validator acceptance, required exports check

import { describe, it, expect } from 'vitest';
import { validateEconomyModule } from './sandbox/validator.js';

// These tests verify that well-formed economy code passes validation,
// and that the validator correctly identifies structural problems.
// The actual Claude API call is tested in integration tests.

describe('economy generator — validator acceptance', () => {
  const validModule = `
export function initState(scenario) {
  const pool = scenario.resources[0].initialValue;
  const n = scenario.agentCount;
  return { pool, round: 0, agentWealth: new Array(n).fill(0), collapsed: false };
}

export function tick(state, decisions, scenario) {
  const maxExtraction = state.pool * 0.20;
  const extractions = decisions.map(function(d) {
    if (!d || d.action !== 'extract') return 0;
    var amt = Number(d.params.amount);
    if (!Number.isFinite(amt) || amt < 0) return 0;
    return Math.min(amt, maxExtraction);
  });
  var total = extractions.reduce(function(s, v) { return s + v; }, 0);
  var actual = total > state.pool
    ? extractions.map(function(e) { return total > 0 ? (e / total) * state.pool : 0; })
    : extractions;
  var poolAfter = Math.max(0, state.pool - actual.reduce(function(s, v) { return s + v; }, 0));
  var regen = poolAfter * 0.10;
  var cap = scenario.resources[0].initialValue;
  var finalPool = Math.min(poolAfter + regen, cap);
  return {
    pool: finalPool,
    round: state.round + 1,
    agentWealth: state.agentWealth.map(function(w, i) { return w + actual[i]; }),
    collapsed: finalPool < 0.01
  };
}

export function extractMetrics(state, scenario) {
  return { poolLevel: state.pool, totalWealth: state.agentWealth.reduce(function(s, v) { return s + v; }, 0) };
}

export function checkInvariants(state, scenario) {
  var violations = [];
  if (state.pool < 0) violations.push('Pool is negative');
  return violations;
}

export function isCollapsed(state, scenario) {
  return state.collapsed === true;
}

export function getObservations(state, agentIndex, scenario) {
  return { poolLevel: state.pool, myWealth: state.agentWealth[agentIndex] };
}
`.trim();

  it('accepts a complete valid economy module', () => {
    const result = validateEconomyModule(validModule);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts economy with const helper values', () => {
    const code = `const MAX_RATE = 0.20;\nconst REGEN_RATE = 0.10;\n${validModule}`;
    const result = validateEconomyModule(code);
    expect(result.valid).toBe(true);
  });

  it('rejects economy with only 5 of 6 exports', () => {
    // Remove isCollapsed
    const incomplete = validModule.replace(/export function isCollapsed[\s\S]*?\n\}/, '');
    const result = validateEconomyModule(incomplete);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('isCollapsed'))).toBe(true);
  });

  it('rejects economy with eval call', () => {
    const malicious = validModule.replace(
      'return state.collapsed === true;',
      'eval("hack"); return state.collapsed === true;'
    );
    const result = validateEconomyModule(malicious);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('eval'))).toBe(true);
  });

  it('rejects economy with require call', () => {
    const malicious = `const fs = require('fs');\n${validModule}`;
    const result = validateEconomyModule(malicious);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('require'))).toBe(true);
  });

  it('validates that initState, tick, extractMetrics, checkInvariants, isCollapsed, getObservations all present', () => {
    const result = validateEconomyModule(validModule);
    expect(result.valid).toBe(true);
    // Verify no missing-export errors
    for (const name of ['initState', 'tick', 'extractMetrics', 'checkInvariants', 'isCollapsed', 'getObservations']) {
      expect(result.errors.some(e => e.includes(name))).toBe(false);
    }
  });
});
