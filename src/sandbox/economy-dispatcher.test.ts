// Tests for economy VM context in sandbox — load, call, strategy execution

import { describe, it, expect, afterEach } from 'vitest';
import { RoundDispatcher } from './round-dispatcher.js';

const VALID_ECONOMY_CODE = `
export function initState(scenario) {
  const pool = scenario.resources[0].initialValue;
  const n = scenario.agentCount;
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
  return { poolLevel: state.pool };
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

const SCENARIO = {
  name: 'Test',
  agentCount: 3,
  resources: [{ name: 'pool', initialValue: 1000 }],
  actions: [{ name: 'extract', params: [{ name: 'amount', type: 'number' }] }],
};

describe('RoundDispatcher — economy VM', () => {
  let dispatcher: RoundDispatcher;

  afterEach(() => {
    dispatcher?.kill();
  });

  it('loads a valid economy module', async () => {
    dispatcher = new RoundDispatcher();
    await dispatcher.spawn();
    const result = await dispatcher.loadEconomy(VALID_ECONOMY_CODE);
    expect(result.success).toBe(true);
  });

  it('rejects economy module with missing exports', async () => {
    dispatcher = new RoundDispatcher();
    await dispatcher.spawn();
    const result = await dispatcher.loadEconomy('export function initState() { return {}; }');
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing exports');
  });

  it('calls initState on loaded economy', async () => {
    dispatcher = new RoundDispatcher();
    await dispatcher.spawn();
    await dispatcher.loadEconomy(VALID_ECONOMY_CODE);
    const result = await dispatcher.callEconomyFunction('initState', [SCENARIO]);
    expect(result.success).toBe(true);
    const state = result.result as Record<string, unknown>;
    expect(state.pool).toBe(1000);
    expect(state.round).toBe(0);
    expect(state.collapsed).toBe(false);
    expect((state.agentWealth as number[]).length).toBe(3);
  });

  it('calls tick to advance one round', async () => {
    dispatcher = new RoundDispatcher();
    await dispatcher.spawn();
    await dispatcher.loadEconomy(VALID_ECONOMY_CODE);
    const initResult = await dispatcher.callEconomyFunction('initState', [SCENARIO]);
    const state = initResult.result;

    const decisions = [
      { action: 'extract', params: { amount: 50 } },
      { action: 'extract', params: { amount: 50 } },
      { action: 'extract', params: { amount: 50 } },
    ];

    const tickResult = await dispatcher.callEconomyFunction('tick', [state, decisions, SCENARIO]);
    expect(tickResult.success).toBe(true);
    const newState = tickResult.result as Record<string, unknown>;
    expect(newState.round).toBe(1);
    expect((newState.pool as number)).toBeLessThan(1000);
    expect((newState.pool as number)).toBeGreaterThan(0);
  });

  it('calls getObservations for each agent', async () => {
    dispatcher = new RoundDispatcher();
    await dispatcher.spawn();
    await dispatcher.loadEconomy(VALID_ECONOMY_CODE);
    const initResult = await dispatcher.callEconomyFunction('initState', [SCENARIO]);
    const state = initResult.result;

    const obsResult = await dispatcher.callEconomyFunction('getObservations', [state, 0, SCENARIO]);
    expect(obsResult.success).toBe(true);
    const obs = obsResult.result as Record<string, unknown>;
    expect(obs.poolLevel).toBe(1000);
    expect(obs.myWealth).toBe(0);
  });

  it('calls isCollapsed on healthy state', async () => {
    dispatcher = new RoundDispatcher();
    await dispatcher.spawn();
    await dispatcher.loadEconomy(VALID_ECONOMY_CODE);
    const initResult = await dispatcher.callEconomyFunction('initState', [SCENARIO]);

    const result = await dispatcher.callEconomyFunction('isCollapsed', [initResult.result, SCENARIO]);
    expect(result.success).toBe(true);
    expect(result.result).toBe(false);
  });

  it('calls checkInvariants on healthy state (returns empty)', async () => {
    dispatcher = new RoundDispatcher();
    await dispatcher.spawn();
    await dispatcher.loadEconomy(VALID_ECONOMY_CODE);
    const initResult = await dispatcher.callEconomyFunction('initState', [SCENARIO]);

    const result = await dispatcher.callEconomyFunction('checkInvariants', [initResult.result, SCENARIO]);
    expect(result.success).toBe(true);
    expect(result.result).toEqual([]);
  });

  it('serialization prevents context leakage between economy and strategy VMs', async () => {
    dispatcher = new RoundDispatcher();
    await dispatcher.spawn();
    await dispatcher.loadEconomy(VALID_ECONOMY_CODE);

    // Get state from economy VM
    const initResult = await dispatcher.callEconomyFunction('initState', [SCENARIO]);
    const state = initResult.result as Record<string, unknown>;

    // Execute a strategy in strategy VM using the state — should work cleanly
    const strategies = ['function test(state) { return 50; }'];
    const roundState = {
      round: 1,
      totalRounds: 50,
      poolLevel: state.pool,
      startingPoolSize: 1000,
      regenerationRate: 0.10,
      maxExtraction: 200,
      agentCount: 1,
      agentWealth: [0],
      agentHistory: [[]],
      poolHistory: [],
      sustainableShare: 14.29,
    };

    const roundResult = await dispatcher.executeRound(strategies, roundState);
    expect(roundResult.timedOut).toBe(false);
    expect(roundResult.childCrashed).toBe(false);
    expect(roundResult.extractions[0]).toBe(50);
  });

  it('existing executeRound still works alongside economy VM', async () => {
    dispatcher = new RoundDispatcher();
    await dispatcher.spawn();

    // Load economy
    await dispatcher.loadEconomy(VALID_ECONOMY_CODE);

    // Now do a regular executeRound (commons mode)
    const strategies = ['function greedy(state) { return state.maxExtraction; }'];
    const state = {
      round: 1,
      totalRounds: 50,
      poolLevel: 1000,
      startingPoolSize: 1000,
      regenerationRate: 0.10,
      maxExtraction: 200,
      agentCount: 1,
      agentWealth: [0],
      agentHistory: [[]],
      poolHistory: [],
      sustainableShare: 14.29,
    };

    const result = await dispatcher.executeRound(strategies, state);
    expect(result.extractions[0]).toBe(200);
  });
});
