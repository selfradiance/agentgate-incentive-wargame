import { describe, it, expect } from 'vitest';
import {
  greedy, cooperative, retaliator, forgiver,
  opportunist, adaptive, stabilizer, FIXTURE_STRATEGIES,
} from './fixtures.js';
import type { StrategyState } from './types.js';

function makeState(overrides: Partial<StrategyState> = {}): StrategyState {
  return {
    round: 1,
    totalRounds: 50,
    poolLevel: 1000,
    startingPoolSize: 1000,
    regenerationRate: 0.10,
    maxExtraction: 200,        // 1000 * 0.20
    agentCount: 7,
    agentIndex: 0,
    myWealth: 0,
    myHistory: [],
    allHistory: [[], [], [], [], [], [], []],
    poolHistory: [],
    sustainableShare: 100 / 7, // ~14.2857
    ...overrides,
  };
}

describe('greedy', () => {
  it('always returns maxExtraction', () => {
    expect(greedy(makeState())).toBe(200);
    expect(greedy(makeState({ maxExtraction: 50 }))).toBe(50);
  });
});

describe('cooperative', () => {
  it('returns sustainableShare when below maxExtraction', () => {
    const state = makeState();
    expect(cooperative(state)).toBeCloseTo(100 / 7);
  });

  it('caps at maxExtraction if sustainableShare exceeds it', () => {
    const state = makeState({ sustainableShare: 300, maxExtraction: 200 });
    expect(cooperative(state)).toBe(200);
  });
});

describe('retaliator', () => {
  it('cooperates on round 1', () => {
    const state = makeState({ round: 1 });
    expect(retaliator(state)).toBeCloseTo(100 / 7);
  });

  it('cooperates when no one over-extracted', () => {
    const share = 100 / 7;
    const state = makeState({
      round: 2,
      allHistory: [[share], [share], [share], [share], [share], [share], [share]],
      poolHistory: [1000],
    });
    expect(retaliator(state)).toBeCloseTo(share);
  });

  it('switches to max permanently after over-extraction', () => {
    const share = 100 / 7;
    const state = makeState({
      round: 2,
      allHistory: [[200], [share], [share], [share], [share], [share], [share]],
      poolHistory: [1000],
    });
    expect(retaliator(state)).toBe(200);
  });

  it('stays at max even if later rounds are cooperative (grim trigger)', () => {
    const share = 100 / 7;
    const state = makeState({
      round: 3,
      allHistory: [[200, share], [share, share], [share, share], [share, share], [share, share], [share, share], [share, share]],
      poolHistory: [1000, 900],
    });
    expect(retaliator(state)).toBe(200);
  });
});

describe('forgiver', () => {
  it('cooperates on round 1', () => {
    expect(forgiver(makeState({ round: 1 }))).toBeCloseTo(100 / 7);
  });

  it('punishes after over-extraction', () => {
    const share = 100 / 7;
    const state = makeState({
      round: 2,
      allHistory: [[200], [share], [share], [share], [share], [share], [share]],
      poolHistory: [1000],
    });
    expect(forgiver(state)).toBe(200);
  });

  it('forgives when last round was all cooperative', () => {
    // Round 2 pool was 900, so sustainable share at round 2 = 900 * 0.10 / 7 ≈ 12.857
    const round2Share = 900 * 0.10 / 7;
    const state = makeState({
      round: 3,
      allHistory: [[200, round2Share], [round2Share, round2Share], [round2Share, round2Share], [round2Share, round2Share], [round2Share, round2Share], [round2Share, round2Share], [round2Share, round2Share]],
      poolHistory: [1000, 900],
    });
    // Last round all at or below sustainable share → forgive
    expect(forgiver(state)).toBeCloseTo(100 / 7);
  });
});

describe('opportunist', () => {
  it('cooperates when pool > 50%', () => {
    const state = makeState({ poolLevel: 600 });
    expect(opportunist(state)).toBeCloseTo(100 / 7);
  });

  it('max extracts when pool < 50%', () => {
    const state = makeState({ poolLevel: 400, maxExtraction: 80 });
    expect(opportunist(state)).toBe(80);
  });

  it('cooperates at exactly 50%', () => {
    const state = makeState({ poolLevel: 500 });
    expect(opportunist(state)).toBeCloseTo(100 / 7);
  });
});

describe('adaptive', () => {
  it('cooperates for first 3 rounds', () => {
    expect(adaptive(makeState({ round: 1 }))).toBeCloseTo(100 / 7);
    expect(adaptive(makeState({ round: 3 }))).toBeCloseTo(100 / 7);
  });

  it('cooperates when pool is growing', () => {
    const state = makeState({
      round: 4,
      poolHistory: [900, 920, 950],
    });
    expect(adaptive(state)).toBeCloseTo(100 / 7);
  });

  it('increases extraction when pool is declining', () => {
    const state = makeState({
      round: 4,
      poolHistory: [1000, 900, 800],
      sustainableShare: 100 / 7,
    });
    const result = adaptive(state);
    expect(result).toBeGreaterThan(100 / 7);
    expect(result).toBeLessThanOrEqual(200);
  });
});

describe('stabilizer', () => {
  it('extracts sustainableShare at default pool', () => {
    const state = makeState();
    expect(stabilizer(state)).toBeCloseTo(1000 * 0.10 / 7);
  });

  it('adjusts with pool level', () => {
    const state = makeState({ poolLevel: 500, maxExtraction: 100 });
    expect(stabilizer(state)).toBeCloseTo(500 * 0.10 / 7);
  });

  it('caps at maxExtraction', () => {
    const state = makeState({ poolLevel: 1000, maxExtraction: 5 });
    expect(stabilizer(state)).toBe(5);
  });
});

describe('FIXTURE_STRATEGIES', () => {
  it('has exactly 7 strategies', () => {
    expect(FIXTURE_STRATEGIES).toHaveLength(7);
  });

  it('all return numbers for a valid state', () => {
    const state = makeState();
    for (const strategy of FIXTURE_STRATEGIES) {
      const result = strategy(state);
      expect(typeof result).toBe('number');
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });
});
