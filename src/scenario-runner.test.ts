// Tests for scenario-aware runner — uses commons economy fixture in sandbox

import { describe, it, expect } from 'vitest';
import { runScenarioSimulation } from './runner.js';
import type { NormalizedScenario, Archetype, Strategy } from './types.js';

// Economy code that matches the commons fixture — runs in child process VM
const ECONOMY_CODE = `
export function initState(scenario) {
  var pool = scenario.resources[0].initialValue;
  var n = scenario.agentCount;
  return { pool: pool, round: 0, agentWealth: new Array(n).fill(0), collapsed: false };
}

export function tick(state, decisions, scenario) {
  var maxExtraction = state.pool * 0.20;
  var extractions = decisions.map(function(d) {
    if (!d || d.action !== 'extract') return 0;
    var amt = Number(d.params.amount);
    if (!Number.isFinite(amt) || amt < 0) return 0;
    return Math.min(amt, maxExtraction);
  });
  var total = extractions.reduce(function(s, v) { return s + v; }, 0);
  var actual = total > state.pool
    ? extractions.map(function(e) { return total > 0 ? (e / total) * state.pool : 0; })
    : extractions;
  var poolAfter = state.pool - actual.reduce(function(s, v) { return s + v; }, 0);
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
  var v = [];
  if (state.pool < 0) v.push('Pool is negative');
  return v;
}

export function isCollapsed(state, scenario) {
  return state.collapsed === true;
}

export function getObservations(state, agentIndex, scenario) {
  return { poolLevel: state.pool, myWealth: state.agentWealth[agentIndex] };
}
`;

const scenario: NormalizedScenario = {
  name: 'Test Commons',
  description: 'Test',
  agentCount: 3,
  roles: [],
  resources: [{ name: 'pool', description: 'Pool', initialValue: 1000, min: 0, max: 1000 }],
  actions: [{
    name: 'extract',
    description: 'Extract',
    params: [{ name: 'amount', type: 'number', min: 0, max: 200, description: 'Amount' }],
    allowedRoles: [],
  }],
  observationModel: [
    { name: 'poolLevel', type: 'number', visibility: 'public', description: 'Pool' },
    { name: 'myWealth', type: 'number', visibility: 'private', description: 'Wealth' },
  ],
  rules: [{ description: 'Pool >= 0', type: 'hard' }],
  ambiguities: [],
  collapseCondition: 'Pool < 0.01',
  successCondition: 'Survives all rounds',
  scenarioClass: 'single-action-simultaneous',
};

// Simple cooperative strategies that return AgentDecision objects
const strategies: Strategy[] = [
  { archetypeIndex: 0, archetypeName: 'Coop1', code: 'function coop1(state) { return { action: "extract", params: { amount: 10 } }; }', isFallback: false },
  { archetypeIndex: 1, archetypeName: 'Coop2', code: 'function coop2(state) { return { action: "extract", params: { amount: 10 } }; }', isFallback: false },
  { archetypeIndex: 2, archetypeName: 'Coop3', code: 'function coop3(state) { return { action: "extract", params: { amount: 10 } }; }', isFallback: false },
];

const archetypes: Archetype[] = [
  { index: 0, name: 'Coop1', description: 'Cooperative' },
  { index: 1, name: 'Coop2', description: 'Cooperative' },
  { index: 2, name: 'Coop3', description: 'Cooperative' },
];

describe('runScenarioSimulation', () => {
  it('runs a basic scenario simulation to completion', async () => {
    const result = await runScenarioSimulation({
      scenario,
      economyCode: ECONOMY_CODE,
      archetypes,
      strategies,
      rounds: 10,
    });

    expect(result.rounds).toBe(10);
    expect(result.collapsed).toBe(false);
    expect(result.collapseRound).toBeNull();
    expect(result.hardViolations).toHaveLength(0);
    expect(result.metricsPerRound.length).toBe(10);
  }, 10000);

  it('collects metrics each round', async () => {
    const result = await runScenarioSimulation({
      scenario,
      economyCode: ECONOMY_CODE,
      archetypes,
      strategies,
      rounds: 5,
    });

    expect(result.metricsPerRound.length).toBe(5);
    for (const m of result.metricsPerRound) {
      expect(typeof m.poolLevel).toBe('number');
      expect(m.poolLevel).toBeGreaterThan(0);
    }
  }, 10000);

  it('detects collapse with greedy strategies', async () => {
    const greedyStrategies = strategies.map((s, i) => ({
      ...s,
      code: `function greedy${i}(state) { return { action: "extract", params: { amount: 200 } }; }`,
    }));

    const result = await runScenarioSimulation({
      scenario,
      economyCode: ECONOMY_CODE,
      archetypes,
      strategies: greedyStrategies,
      rounds: 50,
    });

    expect(result.collapsed).toBe(true);
    expect(result.collapseRound).toBeGreaterThan(0);
    expect(result.rounds).toBeLessThan(50);
  }, 10000);

  it('logs invalid decisions as no-ops', async () => {
    const badStrategies = [
      ...strategies.slice(0, 2),
      { archetypeIndex: 2, archetypeName: 'Bad', code: 'function bad(state) { return "not a decision"; }', isFallback: false },
    ];

    const result = await runScenarioSimulation({
      scenario,
      economyCode: ECONOMY_CODE,
      archetypes,
      strategies: badStrategies,
      rounds: 5,
    });

    // The bad strategy should produce invalid decision each round
    expect(result.invalidDecisions.length).toBeGreaterThan(0);
    expect(result.invalidDecisions[0].agentIndex).toBe(2);
    // Simulation should still complete
    expect(result.rounds).toBe(5);
  }, 10000);

  it('treats invalid decisions as null no-ops instead of inventing a first action', async () => {
    const noOpEconomy = `
export function initState(scenario) {
  return { round: 0, acted: 0 };
}

export function tick(state, decisions, scenario) {
  return {
    round: state.round + 1,
    acted: state.acted + decisions.filter(d => d !== null).length,
  };
}

export function extractMetrics(state, scenario) {
  return { acted: state.acted };
}

export function checkInvariants(state, scenario) {
  return [];
}

export function isCollapsed(state, scenario) {
  return false;
}

export function getObservations(state, agentIndex, scenario) {
  return { poolLevel: 1000, myWealth: 0 };
}
`;

    const badStrategies = [
      { archetypeIndex: 0, archetypeName: 'Bad0', code: 'function bad0(state) { return "not a decision"; }', isFallback: false },
      { archetypeIndex: 1, archetypeName: 'Bad1', code: 'function bad1(state) { return "not a decision"; }', isFallback: false },
      { archetypeIndex: 2, archetypeName: 'Bad2', code: 'function bad2(state) { return "not a decision"; }', isFallback: false },
    ];

    const result = await runScenarioSimulation({
      scenario,
      economyCode: noOpEconomy,
      archetypes,
      strategies: badStrategies,
      rounds: 3,
    });

    expect(result.invalidDecisions).toHaveLength(9);
    expect((result.finalState as Record<string, unknown>).acted).toBe(0);
  }, 10000);

  it('records a hard violation instead of throwing when tick returns a non-object root', async () => {
    const malformedEconomy = `
export function initState(scenario) {
  return { round: 0 };
}

export function tick(state, decisions, scenario) {
  return null;
}

export function extractMetrics(state, scenario) {
  return { round: state.round };
}

export function checkInvariants(state, scenario) {
  return [];
}

export function isCollapsed(state, scenario) {
  return false;
}

export function getObservations(state, agentIndex, scenario) {
  return { poolLevel: 1000, myWealth: 0 };
}
`;

    const result = await runScenarioSimulation({
      scenario,
      economyCode: malformedEconomy,
      archetypes,
      strategies,
      rounds: 2,
    });

    expect(result.hardViolations.length).toBeGreaterThan(0);
    expect(result.hardViolations[0].details).toContain('plain object root');
    expect(result.rounds).toBe(0);
  }, 10000);

  it('rejects role-gated actions when the economy does not provide _role metadata', async () => {
    const roleScenario: NormalizedScenario = {
      ...scenario,
      roles: [{ name: 'harvester', description: 'Harvests' }],
      actions: [{
        name: 'extract',
        description: 'Extract',
        params: [{ name: 'amount', type: 'number', min: 0, max: 200, description: 'Amount' }],
        allowedRoles: ['harvester'],
      }],
    };

    const result = await runScenarioSimulation({
      scenario: roleScenario,
      economyCode: ECONOMY_CODE,
      archetypes,
      strategies,
      rounds: 2,
    });

    expect(result.invalidDecisions.length).toBeGreaterThan(0);
    expect(result.invalidDecisions[0].errors.some(e => e.includes('requires an agent role'))).toBe(true);
  }, 10000);
});
