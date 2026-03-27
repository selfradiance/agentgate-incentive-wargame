import { describe, it, expect } from 'vitest';
import { createEconomyState, processRound } from './economy.js';
import type { GameConfig } from './types.js';

const defaultConfig: GameConfig = {
  poolSize: 1000,
  regenerationRate: 0.10,
  maxExtractionRate: 0.20,
  rounds: 50,
  agentCount: 7,
};

function makeConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...defaultConfig, ...overrides };
}

describe('createEconomyState', () => {
  it('initializes with correct defaults', () => {
    const state = createEconomyState(defaultConfig);
    expect(state.pool).toBe(1000);
    expect(state.round).toBe(0);
    expect(state.agentWealth).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(state.agentHistory).toEqual([[], [], [], [], [], [], []]);
    expect(state.poolHistory).toEqual([]);
    expect(state.collapsed).toBe(false);
    expect(state.collapseRound).toBeNull();
  });
});

describe('processRound', () => {
  it('normal extraction — everyone gets what they asked for', () => {
    const config = makeConfig();
    const state = createEconomyState(config);
    const requested = [10, 10, 10, 10, 10, 10, 10]; // total 70, pool 1000

    const result = processRound(state, requested, config);

    expect(result.actual).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect(result.poolBefore).toBe(1000);
    // pool after extraction: 1000 - 70 = 930, regen: 930 * 1.1 = 1023 → capped at 1000
    expect(result.poolAfter).toBe(1000);
    expect(result.collapsed).toBe(false);
  });

  it('over-extraction — pro-rata rationing with Math.floor truncation', () => {
    const config = makeConfig({ agentCount: 3 });
    const state = createEconomyState(config);
    state.pool = 100;

    // Total requested: 200, exceeds pool of 100
    const requested = [80, 60, 60];
    const result = processRound(state, requested, config);

    // Pro-rata: 80/200 * 100 = 40, 60/200 * 100 = 30, 60/200 * 100 = 30
    // Math.floor truncation: floor(40*100)/100=40, floor(30*100)/100=30
    expect(result.actual).toEqual([40, 30, 30]);

    // Total actual: 100, pool after: 0, regen: 0, collapsed
    expect(result.poolAfter).toBe(0);
    expect(result.collapsed).toBe(true);
  });

  it('pro-rata truncation guarantees sum does not exceed pool', () => {
    const config = makeConfig({ agentCount: 3 });
    const state = createEconomyState(config);
    state.pool = 100;

    // Requests that would produce non-integer pro-rata shares
    const requested = [50, 50, 50]; // total 150
    const result = processRound(state, requested, config);

    // Each: floor(50/150 * 100 * 100) / 100 = floor(3333.33) / 100 = 33.33
    expect(result.actual).toEqual([33.33, 33.33, 33.33]);

    // Total actual: 99.99, pool: 100 - 99.99 = 0.01
    const totalActual = result.actual.reduce((s, a) => s + a, 0);
    expect(totalActual).toBeLessThanOrEqual(100);
  });

  it('regeneration math — pool grows by regeneration rate', () => {
    const config = makeConfig({ agentCount: 1 });
    const state = createEconomyState(config);
    state.pool = 500;

    const result = processRound(state, [0], config);

    // No extraction, regen: 500 * 1.1 = 550
    expect(result.poolAfter).toBe(550);
  });

  it('carrying capacity cap — pool cannot exceed starting size', () => {
    const config = makeConfig({ agentCount: 1 });
    const state = createEconomyState(config);
    state.pool = 950;

    const result = processRound(state, [0], config);

    // Regen: 950 * 1.1 = 1045, capped at 1000
    expect(result.poolAfter).toBe(1000);
  });

  it('collapse detection — pool below 0.01', () => {
    const config = makeConfig({ agentCount: 1, regenerationRate: 0 });
    const state = createEconomyState(config);
    state.pool = 5;

    const result = processRound(state, [5], config);

    // Pool: 5 - 5 = 0, regen: 0, collapse
    expect(result.poolAfter).toBe(0);
    expect(result.collapsed).toBe(true);
    expect(state.collapseRound).toBe(1);
  });

  it('pool at 0.01 does not collapse', () => {
    const config = makeConfig({ agentCount: 1, regenerationRate: 0 });
    const state = createEconomyState(config);
    state.pool = 1;

    const result = processRound(state, [0.99], config);

    // Pool: 1 - 0.99 = 0.01, no regen, exactly 0.01 → NOT collapsed
    expect(result.poolAfter).toBe(0.01);
    expect(result.collapsed).toBe(false);
  });

  it('all agents extract 0', () => {
    const config = makeConfig();
    const state = createEconomyState(config);

    const result = processRound(state, [0, 0, 0, 0, 0, 0, 0], config);

    // Pool: 1000, regen: 1000 * 1.1 = 1100, capped at 1000
    expect(result.poolAfter).toBe(1000);
    expect(result.actual).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('single agent', () => {
    const config = makeConfig({ agentCount: 1 });
    const state = createEconomyState(config);

    const result = processRound(state, [100], config);

    expect(result.actual).toEqual([100]);
    // Pool: 1000 - 100 = 900, regen: 900 * 1.1 = 990
    expect(result.poolAfter).toBe(990);
    expect(state.agentWealth).toEqual([100]);
  });

  it('floating-point rounding — no drift across multiple rounds', () => {
    const config = makeConfig({ agentCount: 3 });
    const state = createEconomyState(config);

    // Run 20 rounds with fractional extractions
    for (let i = 0; i < 20; i++) {
      processRound(state, [14.33, 14.33, 14.33], config);
    }

    // Pool should be a clean 2-decimal number
    const decimalPlaces = state.pool.toString().split('.')[1]?.length ?? 0;
    expect(decimalPlaces).toBeLessThanOrEqual(2);

    // Wealth should also be clean
    for (const w of state.agentWealth) {
      const dp = w.toString().split('.')[1]?.length ?? 0;
      expect(dp).toBeLessThanOrEqual(2);
    }
  });

  it('tracks pool history and agent history correctly', () => {
    const config = makeConfig({ agentCount: 2 });
    const state = createEconomyState(config);

    processRound(state, [10, 20], config);
    processRound(state, [5, 15], config);

    expect(state.poolHistory).toHaveLength(2);
    expect(state.poolHistory[0]).toBe(1000); // pool before round 1
    expect(state.agentHistory[0]).toEqual([10, 5]);
    expect(state.agentHistory[1]).toEqual([20, 15]);
    expect(state.agentWealth[0]).toBe(15);
    expect(state.agentWealth[1]).toBe(35);
  });

  it('wealth accumulates across rounds', () => {
    const config = makeConfig({ agentCount: 1 });
    const state = createEconomyState(config);

    processRound(state, [50], config);
    processRound(state, [50], config);
    processRound(state, [50], config);

    expect(state.agentWealth[0]).toBe(150);
  });
});
