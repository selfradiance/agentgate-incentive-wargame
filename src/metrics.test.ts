import { describe, it, expect } from 'vitest';
import {
  computeGini,
  computePoolSurvival,
  computeAgentWealth,
  computeOverExtractionRate,
  computeSystemEfficiency,
  computeResourceHealth,
  computeCollapseVelocity,
  computeFirstOverExtraction,
  computeAllMetrics,
} from './metrics.js';
import type { SimulationLog, GameConfig, Archetype, EconomyState, RoundResult, Strategy } from './types.js';

const defaultConfig: GameConfig = {
  poolSize: 1000,
  regenerationRate: 0.10,
  maxExtractionRate: 0.20,
  rounds: 50,
  agentCount: 3,
};

const archetypes3: Archetype[] = [
  { index: 0, name: 'Greedy', description: '' },
  { index: 1, name: 'Cooperative', description: '' },
  { index: 2, name: 'Stabilizer', description: '' },
];

function makeLog(overrides: Partial<SimulationLog> = {}): SimulationLog {
  return {
    config: defaultConfig,
    archetypes: archetypes3,
    strategies: archetypes3.map(a => ({ archetypeIndex: a.index, archetypeName: a.name, code: '', isFallback: false })),
    rounds: [],
    finalState: {
      pool: 1000,
      round: 0,
      agentWealth: [0, 0, 0],
      agentHistory: [[], [], []],
      poolHistory: [],
      collapsed: false,
      collapseRound: null,
    },
    ...overrides,
  };
}

function makeRound(overrides: Partial<RoundResult> = {}): RoundResult {
  return {
    round: 1,
    poolBefore: 1000,
    poolAfter: 950,
    requested: [50, 20, 20],
    actual: [50, 20, 20],
    agentWealth: [50, 20, 20],
    collapsed: false,
    ...overrides,
  };
}

// --- Gini ---

describe('computeGini', () => {
  it('returns 0 for equal wealth', () => {
    expect(computeGini([100, 100, 100]).gini).toBe(0);
  });

  it('returns 0 for all zero wealth', () => {
    expect(computeGini([0, 0, 0]).gini).toBe(0);
  });

  it('returns high gini for unequal wealth', () => {
    const result = computeGini([1000, 0, 0]);
    // Gini for [1000, 0, 0]: sum of diffs = 4000, 2*3*333.33 = 2000 → 4000/2000 = ~0.6667
    expect(result.gini).toBeCloseTo(0.6667, 3);
  });

  it('returns moderate gini for moderate inequality', () => {
    const result = computeGini([100, 50, 50]);
    expect(result.gini).toBeGreaterThan(0);
    expect(result.gini).toBeLessThan(0.5);
  });
});

// --- Pool Survival ---

describe('computePoolSurvival', () => {
  it('reports incomplete when the run ended before all rounds were played', () => {
    const log = makeLog();
    const result = computePoolSurvival(log);
    expect(result.survived).toBe(false);
    expect(result.completed).toBe(false);
    expect(result.collapseRound).toBeNull();
  });

  it('reports collapse with round number', () => {
    const log = makeLog({
      finalState: {
        pool: 0, round: 10, agentWealth: [500, 200, 100],
        agentHistory: [], poolHistory: [], collapsed: true, collapseRound: 10,
      },
    });
    const result = computePoolSurvival(log);
    expect(result.survived).toBe(false);
    expect(result.completed).toBe(true);
    expect(result.collapseRound).toBe(10);
  });

  it('reports survival only when all configured rounds completed', () => {
    const log = makeLog({
      rounds: [
        makeRound({ round: 1 }),
        makeRound({ round: 2 }),
        makeRound({ round: 3 }),
      ],
      config: { ...defaultConfig, rounds: 3 },
      finalState: {
        pool: 900, round: 3, agentWealth: [10, 10, 10],
        agentHistory: [[], [], []], poolHistory: [1000, 950, 900], collapsed: false, collapseRound: null,
      },
    });
    const result = computePoolSurvival(log);
    expect(result.survived).toBe(true);
    expect(result.completed).toBe(true);
  });
});

// --- Agent Wealth ---

describe('computeAgentWealth', () => {
  it('returns agents sorted by wealth descending', () => {
    const log = makeLog({
      finalState: {
        pool: 500, round: 5, agentWealth: [100, 300, 200],
        agentHistory: [], poolHistory: [], collapsed: false, collapseRound: null,
      },
    });
    const result = computeAgentWealth(log);
    expect(result[0]).toEqual({ archetypeName: 'Cooperative', totalWealth: 300 });
    expect(result[1]).toEqual({ archetypeName: 'Stabilizer', totalWealth: 200 });
    expect(result[2]).toEqual({ archetypeName: 'Greedy', totalWealth: 100 });
  });
});

// --- Over-Extraction Rate ---

describe('computeOverExtractionRate', () => {
  it('returns 0 when no rounds played', () => {
    const log = makeLog();
    const result = computeOverExtractionRate(log);
    expect(result.overExtractionRate).toBe(0);
    expect(result.totalAgentRounds).toBe(0);
  });

  it('counts over-extractions correctly', () => {
    // MSY at pool 1000 = 100, sustainable share = 100/3 ≈ 33.33
    // Agent 0 extracted 50 (over), agents 1,2 extracted 20 (under)
    const log = makeLog({
      rounds: [
        makeRound({ round: 1, poolBefore: 1000, actual: [50, 20, 20] }),
        makeRound({ round: 2, poolBefore: 900, actual: [30, 30, 30] }),
      ],
    });
    const result = computeOverExtractionRate(log);
    // Round 1: share=33.33, agent 0 over (50>33.33) → 1 over-extraction
    // Round 2: share=30, agent 0 at 30 (not over), agents 1,2 at 30 (not over) → 0
    expect(result.overExtractionCount).toBe(1);
    expect(result.totalAgentRounds).toBe(6);
    expect(result.overExtractionRate).toBeCloseTo(1 / 6, 3);
  });

  it('handles known all-over-extraction scenario', () => {
    const log = makeLog({
      rounds: [
        makeRound({ round: 1, poolBefore: 1000, actual: [100, 100, 100] }),
      ],
    });
    // sustainable share = 100/3 ≈ 33.33, all 3 agents at 100 → 3 over-extractions
    const result = computeOverExtractionRate(log);
    expect(result.overExtractionCount).toBe(3);
    expect(result.overExtractionRate).toBe(1);
  });

  it('uses the rounded sustainable share seen by strategies', () => {
    const config = { ...defaultConfig, agentCount: 7 };
    const actual = new Array(7).fill(14.29);
    const log = makeLog({
      config,
      archetypes: Array.from({ length: 7 }, (_, index) => ({ index, name: `A${index}`, description: '' })),
      strategies: Array.from({ length: 7 }, (_, index) => ({
        archetypeIndex: index,
        archetypeName: `A${index}`,
        code: '',
        isFallback: false,
      })),
      finalState: {
        pool: 900,
        round: 1,
        agentWealth: actual,
        agentHistory: actual.map(amount => [amount]),
        poolHistory: [1000],
        collapsed: false,
        collapseRound: null,
      },
      rounds: [
        makeRound({
          poolBefore: 1000,
          actual,
          requested: actual,
          agentWealth: actual,
        }),
      ],
    });

    const result = computeOverExtractionRate(log);
    expect(result.overExtractionCount).toBe(0);
    expect(computeFirstOverExtraction(log)).toBeNull();
  });
});

// --- System Efficiency ---

describe('computeSystemEfficiency', () => {
  it('returns 0 for no rounds', () => {
    const result = computeSystemEfficiency(makeLog());
    expect(result.efficiency).toBe(0);
  });

  it('computes efficiency against MSY', () => {
    // MSY at pool 1000 = 100. Total extraction = 90. Efficiency = 90/100 = 0.9
    const log = makeLog({
      rounds: [makeRound({ round: 1, poolBefore: 1000, actual: [30, 30, 30] })],
    });
    const result = computeSystemEfficiency(log);
    expect(result.efficiency).toBe(0.9);
    expect(result.totalActualExtraction).toBe(90);
    expect(result.totalMSY).toBe(100);
  });

  it('efficiency can exceed 1.0 (over-extraction)', () => {
    const log = makeLog({
      rounds: [makeRound({ round: 1, poolBefore: 1000, actual: [100, 100, 100] })],
    });
    const result = computeSystemEfficiency(log);
    // Total: 300, MSY: 100 → 3.0
    expect(result.efficiency).toBe(3);
  });
});

// --- Resource Health ---

describe('computeResourceHealth', () => {
  it('returns 1s for no rounds', () => {
    const result = computeResourceHealth(makeLog());
    expect(result.minPoolFraction).toBe(1);
    expect(result.avgPoolFraction).toBe(1);
    expect(result.finalPoolFraction).toBe(1);
  });

  it('computes fractions from pool trajectory', () => {
    const log = makeLog({
      config: { ...defaultConfig, poolSize: 1000 },
      rounds: [
        makeRound({ round: 1, poolAfter: 800 }),
        makeRound({ round: 2, poolAfter: 600 }),
        makeRound({ round: 3, poolAfter: 900 }),
      ],
    });
    const result = computeResourceHealth(log);
    expect(result.minPoolFraction).toBe(0.6);
    expect(result.avgPoolFraction).toBeCloseTo(0.7667, 3);
    expect(result.finalPoolFraction).toBe(0.9);
  });

  it('returns 0 final fraction on collapse', () => {
    const log = makeLog({
      rounds: [
        makeRound({ round: 1, poolAfter: 500 }),
        makeRound({ round: 2, poolAfter: 0, collapsed: true }),
      ],
    });
    const result = computeResourceHealth(log);
    expect(result.finalPoolFraction).toBe(0);
    expect(result.minPoolFraction).toBe(0);
  });
});

// --- Collapse Velocity ---

describe('computeCollapseVelocity', () => {
  it('returns nulls when no over-extraction ever happened', () => {
    // All extractions below MSY
    const log = makeLog({
      rounds: [makeRound({ round: 1, poolBefore: 1000, actual: [10, 10, 10] })],
    });
    const result = computeCollapseVelocity(log);
    expect(result.tippingPointRound).toBeNull();
    expect(result.roundsFromTipToCollapse).toBeNull();
  });

  it('identifies tipping point without collapse', () => {
    const log = makeLog({
      rounds: [
        makeRound({ round: 1, poolBefore: 1000, actual: [10, 10, 10] }),
        makeRound({ round: 2, poolBefore: 950, actual: [50, 50, 50] }), // total 150 > MSY 95
      ],
    });
    const result = computeCollapseVelocity(log);
    expect(result.tippingPointRound).toBe(2);
    expect(result.roundsFromTipToCollapse).toBeNull();
  });

  it('computes rounds from tip to collapse', () => {
    const log = makeLog({
      finalState: {
        pool: 0, round: 5, agentWealth: [500, 200, 100],
        agentHistory: [], poolHistory: [], collapsed: true, collapseRound: 5,
      },
      rounds: [
        makeRound({ round: 1, poolBefore: 1000, actual: [10, 10, 10] }),
        makeRound({ round: 2, poolBefore: 900, actual: [50, 50, 50] }), // total 150 > MSY 90
        makeRound({ round: 3, poolBefore: 600, actual: [100, 100, 100] }),
        makeRound({ round: 4, poolBefore: 200, actual: [50, 50, 50] }),
        makeRound({ round: 5, poolBefore: 10, actual: [5, 5, 5], poolAfter: 0, collapsed: true }),
      ],
    });
    const result = computeCollapseVelocity(log);
    expect(result.tippingPointRound).toBe(2);
    expect(result.roundsFromTipToCollapse).toBe(3); // 5 - 2
  });
});

// --- First Over-Extraction Event ---

describe('computeFirstOverExtraction', () => {
  it('returns null when no agent ever over-extracts', () => {
    const log = makeLog({
      rounds: [makeRound({ round: 1, poolBefore: 1000, actual: [10, 10, 10] })],
    });
    expect(computeFirstOverExtraction(log)).toBeNull();
  });

  it('identifies first over-extractor', () => {
    // sustainable share at pool 1000 = 100/3 ≈ 33.33
    const log = makeLog({
      rounds: [
        makeRound({ round: 1, poolBefore: 1000, actual: [10, 10, 10] }),
        makeRound({ round: 2, poolBefore: 950, actual: [10, 50, 10] }), // agent 1 over-extracts (50 > 31.67)
      ],
    });
    const result = computeFirstOverExtraction(log);
    expect(result).not.toBeNull();
    expect(result!.round).toBe(2);
    expect(result!.agentIndex).toBe(1);
    expect(result!.archetypeName).toBe('Cooperative');
    expect(result!.amount).toBe(50);
  });
});

// --- computeAllMetrics ---

describe('computeAllMetrics', () => {
  it('returns all 8 metrics', () => {
    const log = makeLog({
      finalState: {
        pool: 800, round: 2, agentWealth: [100, 50, 50],
        agentHistory: [[50, 50], [25, 25], [25, 25]], poolHistory: [1000, 900],
        collapsed: false, collapseRound: null,
      },
      rounds: [
        makeRound({ round: 1, poolBefore: 1000, poolAfter: 900, actual: [50, 25, 25] }),
        makeRound({ round: 2, poolBefore: 900, poolAfter: 800, actual: [50, 25, 25] }),
      ],
    });
    const metrics = computeAllMetrics(log);
    expect(metrics.gini).toBeDefined();
    expect(metrics.poolSurvival).toBeDefined();
    expect(metrics.poolSurvival.completed).toBe(false);
    expect(metrics.agentWealth).toHaveLength(3);
    expect(metrics.overExtractionRate).toBeDefined();
    expect(metrics.systemEfficiency).toBeDefined();
    expect(metrics.resourceHealth).toBeDefined();
    expect(metrics.collapseVelocity).toBeDefined();
    expect(metrics).toHaveProperty('firstOverExtraction');
  });
});
