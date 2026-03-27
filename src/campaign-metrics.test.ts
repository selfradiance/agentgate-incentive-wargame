// Tests for v0.2.0 campaign metrics: canonical battery, drift, convergence,
// resilience trend, adaptation theater, archetype collapse.

import { describe, it, expect } from 'vitest';
import {
  buildCanonicalStateBattery,
  extractRunSnapshots,
  computeStrategyDrift,
  computeBehavioralConvergence,
  computeResilienceTrend,
  detectAdaptationTheater,
  detectArchetypeCollapse,
} from './metrics.js';
import type {
  GameConfig,
  Strategy,
  SimulationLog,
  Archetype,
  RunResult,
  CanonicalState,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// --- Helpers ---

function makeStrategy(name: string, code: string): Strategy {
  return { archetypeIndex: 0, archetypeName: name, code, isFallback: false };
}

function makeStrategies(codes: string[]): Strategy[] {
  return codes.map((code, i) => ({
    archetypeIndex: i,
    archetypeName: `Agent${i}`,
    code,
    isFallback: false,
  }));
}

function makeMinimalRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runNumber: 1,
    log: {
      config: DEFAULT_CONFIG,
      archetypes: [],
      strategies: [],
      rounds: [
        {
          round: 1,
          poolBefore: 1000,
          poolAfter: 900,
          requested: [20, 20, 20, 20, 20, 20, 20],
          actual: [20, 20, 20, 20, 20, 20, 20],
          agentWealth: [20, 20, 20, 20, 20, 20, 20],
          collapsed: false,
        },
      ],
      finalState: {
        pool: 900,
        round: 1,
        agentWealth: [20, 20, 20, 20, 20, 20, 20],
        agentHistory: Array.from({ length: 7 }, () => [20]),
        poolHistory: [1000],
        collapsed: false,
        collapseRound: null,
      },
    },
    metrics: {
      gini: { gini: 0 },
      poolSurvival: { survived: true, completed: true, collapseRound: null },
      agentWealth: [],
      overExtractionRate: { overExtractionRate: 0.1, overExtractionCount: 1, totalAgentRounds: 7 },
      systemEfficiency: { efficiency: 1, totalActualExtraction: 140, totalMSY: 100 },
      resourceHealth: { minPoolFraction: 0.9, avgPoolFraction: 0.9, finalPoolFraction: 0.9 },
      collapseVelocity: { tippingPointRound: null, roundsFromTipToCollapse: null },
      firstOverExtraction: null,
    },
    strategies: [],
    convergence: { score: 0.5 },
    ...overrides,
  };
}

// --- Canonical State Battery ---

describe('buildCanonicalStateBattery', () => {
  it('returns exactly 5 states', () => {
    const battery = buildCanonicalStateBattery(DEFAULT_CONFIG);
    expect(battery).toHaveLength(5);
  });

  it('has expected labels', () => {
    const battery = buildCanonicalStateBattery(DEFAULT_CONFIG);
    const labels = battery.map(s => s.label);
    expect(labels).toEqual(['Healthy', 'Stressed', 'Near-Collapse', 'Post-Rationing', 'Stable-Growth']);
  });

  it('states have valid pool levels', () => {
    const battery = buildCanonicalStateBattery(DEFAULT_CONFIG);
    for (const state of battery) {
      expect(state.poolLevel).toBeGreaterThan(0);
      expect(state.poolLevel).toBeLessThanOrEqual(DEFAULT_CONFIG.poolSize);
      expect(state.maxExtraction).toBeGreaterThan(0);
      expect(state.sustainableShare).toBeGreaterThan(0);
    }
  });

  it('Healthy state has pool at ~85%', () => {
    const battery = buildCanonicalStateBattery(DEFAULT_CONFIG);
    const healthy = battery[0];
    expect(healthy.poolLevel).toBe(DEFAULT_CONFIG.poolSize * 0.85);
  });

  it('Near-Collapse state has pool at ~15%', () => {
    const battery = buildCanonicalStateBattery(DEFAULT_CONFIG);
    const nearCollapse = battery[2];
    expect(nearCollapse.poolLevel).toBe(DEFAULT_CONFIG.poolSize * 0.15);
  });
});

// --- Run-Specific Snapshots ---

describe('extractRunSnapshots', () => {
  it('returns empty for empty log', () => {
    const log: SimulationLog = {
      config: DEFAULT_CONFIG,
      archetypes: [],
      strategies: [],
      rounds: [],
      finalState: {
        pool: 1000, round: 0, agentWealth: [], agentHistory: [],
        poolHistory: [], collapsed: false, collapseRound: null,
      },
    };
    expect(extractRunSnapshots(log)).toHaveLength(0);
  });

  it('extracts highest extraction round', () => {
    const log: SimulationLog = {
      config: { ...DEFAULT_CONFIG, agentCount: 2, rounds: 3 },
      archetypes: [],
      strategies: [],
      rounds: [
        { round: 1, poolBefore: 1000, poolAfter: 800, requested: [100, 100], actual: [100, 100], agentWealth: [100, 100], collapsed: false },
        { round: 2, poolBefore: 800, poolAfter: 500, requested: [200, 200], actual: [150, 150], agentWealth: [250, 250], collapsed: false },
        { round: 3, poolBefore: 500, poolAfter: 400, requested: [50, 50], actual: [50, 50], agentWealth: [300, 300], collapsed: false },
      ],
      finalState: {
        pool: 400, round: 3, agentWealth: [300, 300],
        agentHistory: [[100, 150, 50], [100, 150, 50]],
        poolHistory: [1000, 800, 500],
        collapsed: false, collapseRound: null,
      },
    };
    const snapshots = extractRunSnapshots(log);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0].label).toBe('Highest-Extraction');
    expect(snapshots[0].isRunSpecific).toBe(true);
  });

  it('includes collapse round when applicable', () => {
    const log: SimulationLog = {
      config: { ...DEFAULT_CONFIG, agentCount: 2, rounds: 3 },
      archetypes: [],
      strategies: [],
      rounds: [
        { round: 1, poolBefore: 100, poolAfter: 10, requested: [50, 50], actual: [45, 45], agentWealth: [45, 45], collapsed: false },
        { round: 2, poolBefore: 10, poolAfter: 0, requested: [10, 10], actual: [5, 5], agentWealth: [50, 50], collapsed: true },
      ],
      finalState: {
        pool: 0, round: 2, agentWealth: [50, 50],
        agentHistory: [[45, 5], [45, 5]],
        poolHistory: [100, 10],
        collapsed: true, collapseRound: 2,
      },
    };
    const snapshots = extractRunSnapshots(log);
    const collapseSnapshot = snapshots.find(s => s.label === 'Collapse');
    expect(collapseSnapshot).toBeDefined();
    expect(collapseSnapshot!.isRunSpecific).toBe(true);
  });
});

// --- Strategy Drift ---

describe('computeStrategyDrift', () => {
  it('returns 0 drift for identical strategies', () => {
    const code = 'function s(state) { return state.sustainableShare; }';
    const strategies = [makeStrategy('A', code)];
    const battery = buildCanonicalStateBattery(DEFAULT_CONFIG);

    const drift = computeStrategyDrift(strategies, strategies, battery);
    expect(drift.average).toBe(0);
    expect(drift.perAgent[0]).toBe(0);
  });

  it('returns positive drift for different strategies', () => {
    const oldCode = 'function s(state) { return 0; }';
    const newCode = 'function s(state) { return state.maxExtraction; }';
    const battery = buildCanonicalStateBattery(DEFAULT_CONFIG);

    const drift = computeStrategyDrift(
      [makeStrategy('A', oldCode)],
      [makeStrategy('A', newCode)],
      battery,
    );
    expect(drift.average).toBeGreaterThan(0);
    expect(drift.perAgent[0]).toBeGreaterThan(0);
  });

  it('drift is bounded 0-1', () => {
    const oldCode = 'function s(state) { return 0; }';
    const newCode = 'function s(state) { return state.maxExtraction; }';
    const battery = buildCanonicalStateBattery(DEFAULT_CONFIG);

    const drift = computeStrategyDrift(
      [makeStrategy('A', oldCode)],
      [makeStrategy('A', newCode)],
      battery,
    );
    expect(drift.perAgent[0]).toBeGreaterThanOrEqual(0);
    expect(drift.perAgent[0]).toBeLessThanOrEqual(1);
  });
});

// --- Behavioral Convergence ---

describe('computeBehavioralConvergence', () => {
  it('returns 1.0 for identical strategies', () => {
    const code = 'function s(state) { return state.sustainableShare; }';
    const strategies = makeStrategies([code, code, code]);
    const battery = buildCanonicalStateBattery(DEFAULT_CONFIG);

    const result = computeBehavioralConvergence(strategies, battery);
    expect(result.score).toBe(1);
  });

  it('returns < 1 for diverse strategies', () => {
    const strategies = makeStrategies([
      'function s(state) { return 0; }',
      'function s(state) { return state.maxExtraction; }',
      'function s(state) { return state.sustainableShare; }',
    ]);
    const battery = buildCanonicalStateBattery(DEFAULT_CONFIG);

    const result = computeBehavioralConvergence(strategies, battery);
    expect(result.score).toBeLessThan(1);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for less than 2 agents', () => {
    const strategies = [makeStrategy('A', 'function s(state) { return 0; }')];
    const battery = buildCanonicalStateBattery(DEFAULT_CONFIG);

    const result = computeBehavioralConvergence(strategies, battery);
    expect(result.score).toBe(0);
  });
});

// --- Resilience Trend ---

describe('computeResilienceTrend', () => {
  it('positive trend: more survival rounds', () => {
    const runs = [
      makeMinimalRunResult({ runNumber: 1 }),
      makeMinimalRunResult({ runNumber: 2 }),
    ];
    // R1: collapsed at round 4, R2: survived 10
    runs[0].log.rounds = Array.from({ length: 4 }, (_, i) => ({
      round: i + 1, poolBefore: 100, poolAfter: i === 3 ? 0 : 50,
      requested: [10], actual: [10], agentWealth: [10], collapsed: i === 3,
    }));
    runs[1].log.rounds = Array.from({ length: 10 }, (_, i) => ({
      round: i + 1, poolBefore: 900, poolAfter: 850,
      requested: [10], actual: [10], agentWealth: [10], collapsed: false,
    }));
    runs[1].log.config = { ...DEFAULT_CONFIG, rounds: 10 };

    const result = computeResilienceTrend(runs);
    expect(result.trend).toBe('positive');
    expect(result.points).toHaveLength(2);
  });

  it('negative trend: fewer survival rounds', () => {
    const runs = [
      makeMinimalRunResult({ runNumber: 1 }),
      makeMinimalRunResult({ runNumber: 2 }),
    ];
    runs[0].log.rounds = Array.from({ length: 10 }, (_, i) => ({
      round: i + 1, poolBefore: 900, poolAfter: 850,
      requested: [10], actual: [10], agentWealth: [10], collapsed: false,
    }));
    runs[1].log.rounds = Array.from({ length: 4 }, (_, i) => ({
      round: i + 1, poolBefore: 100, poolAfter: i === 3 ? 0 : 50,
      requested: [10], actual: [10], agentWealth: [10], collapsed: i === 3,
    }));

    const result = computeResilienceTrend(runs);
    expect(result.trend).toBe('negative');
  });

  it('flat trend: same rounds, similar pool health', () => {
    const runs = [
      makeMinimalRunResult({ runNumber: 1 }),
      makeMinimalRunResult({ runNumber: 2 }),
    ];
    // Both 10 rounds, same pool health
    const makeRounds = () => Array.from({ length: 10 }, (_, i) => ({
      round: i + 1, poolBefore: 900, poolAfter: 850,
      requested: [10], actual: [10], agentWealth: [10], collapsed: false,
    }));
    runs[0].log.rounds = makeRounds();
    runs[1].log.rounds = makeRounds();

    const result = computeResilienceTrend(runs);
    expect(result.trend).toBe('flat');
  });
});

// --- Adaptation Theater ---

describe('detectAdaptationTheater', () => {
  it('detects theater when low drift after collapse', () => {
    const runs = [
      makeMinimalRunResult({ runNumber: 1 }),
      makeMinimalRunResult({
        runNumber: 2,
        drift: { perAgent: [0.05, 0.03, 0.02], average: 0.033 },
      }),
    ];
    runs[0].log.finalState.collapsed = true;
    runs[0].metrics.poolSurvival.collapseRound = 5;

    const result = detectAdaptationTheater(runs);
    expect(result.detected).toBe(true);
    expect(result.runTransitions[0].verdict).toBe('theater');
  });

  it('labels equilibrium when low drift after survival', () => {
    const runs = [
      makeMinimalRunResult({ runNumber: 1 }),
      makeMinimalRunResult({
        runNumber: 2,
        drift: { perAgent: [0.05, 0.03, 0.02], average: 0.033 },
      }),
    ];

    const result = detectAdaptationTheater(runs);
    expect(result.detected).toBe(false);
    expect(result.runTransitions[0].verdict).toBe('equilibrium');
  });

  it('labels normal when drift is above threshold', () => {
    const runs = [
      makeMinimalRunResult({ runNumber: 1 }),
      makeMinimalRunResult({
        runNumber: 2,
        drift: { perAgent: [0.3, 0.2, 0.4], average: 0.3 },
      }),
    ];

    const result = detectAdaptationTheater(runs);
    expect(result.detected).toBe(false);
    expect(result.runTransitions[0].verdict).toBe('normal');
  });
});

// --- Archetype Collapse ---

describe('detectArchetypeCollapse', () => {
  it('detects collapse when convergence > 0.8', () => {
    const runs = [
      makeMinimalRunResult({ runNumber: 1 }),
    ];
    runs[0].convergence = { score: 0.85 };

    const result = detectArchetypeCollapse(runs);
    expect(result.detected).toBe(true);
    expect(result.finalConvergence).toBe(0.85);
    expect(result.message).toContain('Archetype Collapse');
  });

  it('no collapse when convergence <= 0.8', () => {
    const runs = [
      makeMinimalRunResult({ runNumber: 1 }),
    ];
    runs[0].convergence = { score: 0.5 };

    const result = detectArchetypeCollapse(runs);
    expect(result.detected).toBe(false);
  });

  it('handles empty runs', () => {
    const result = detectArchetypeCollapse([]);
    expect(result.detected).toBe(false);
    expect(result.finalConvergence).toBe(0);
  });
});
