import { describe, it, expect } from 'vitest';
import { runSimulation } from './runner.js';
import { ARCHETYPES } from './archetypes.js';
import { FIXTURE_STRATEGIES } from './fixtures.js';
import { computeAllMetrics } from './metrics.js';
import type { GameConfig, Strategy } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// Convert fixture functions to Strategy objects with code strings
function fixtureStrategies(): Strategy[] {
  return FIXTURE_STRATEGIES.map((fn, i) => ({
    archetypeIndex: i,
    archetypeName: ARCHETYPES[i].name,
    code: fn.toString(),
    isFallback: false,
  }));
}

describe('runSimulation — full integration with fixtures', () => {
  it('runs 50 rounds with all 7 archetypes', async () => {
    const log = await runSimulation({
      config: DEFAULT_CONFIG,
      archetypes: ARCHETYPES,
      strategies: fixtureStrategies(),
    });

    expect(log.rounds.length).toBeGreaterThan(0);
    expect(log.rounds.length).toBeLessThanOrEqual(50);
    expect(log.config).toEqual(DEFAULT_CONFIG);
    expect(log.archetypes).toHaveLength(7);
    expect(log.strategies).toHaveLength(7);

    // Every round should have 7 extractions
    for (const round of log.rounds) {
      expect(round.actual).toHaveLength(7);
      expect(round.requested).toHaveLength(7);
      // All extractions should be non-negative
      for (const a of round.actual) {
        expect(a).toBeGreaterThanOrEqual(0);
      }
    }

    // Final state should be consistent
    expect(log.finalState.agentWealth).toHaveLength(7);
    expect(log.finalState.round).toBe(log.rounds.length);
  }, 30000);

  it('metrics are computable on the simulation log', async () => {
    const log = await runSimulation({
      config: DEFAULT_CONFIG,
      archetypes: ARCHETYPES,
      strategies: fixtureStrategies(),
    });

    const metrics = computeAllMetrics(log);

    // Gini should be between 0 and 1
    expect(metrics.gini.gini).toBeGreaterThanOrEqual(0);
    expect(metrics.gini.gini).toBeLessThanOrEqual(1);

    // Agent wealth should have 7 entries
    expect(metrics.agentWealth).toHaveLength(7);

    // Greedy should be the first over-extractor (it always extracts max)
    if (metrics.firstOverExtraction) {
      expect(metrics.firstOverExtraction.round).toBe(1);
      expect(metrics.firstOverExtraction.archetypeName).toBe('Greedy');
    }

    // Over-extraction rate should be > 0 (Greedy always over-extracts)
    expect(metrics.overExtractionRate.overExtractionRate).toBeGreaterThan(0);

    // Efficiency should be > 0
    expect(metrics.systemEfficiency.efficiency).toBeGreaterThan(0);
  }, 30000);

  it('onRound callback fires for each round', async () => {
    const roundResults: number[] = [];

    await runSimulation({
      config: { ...DEFAULT_CONFIG, rounds: 5 },
      archetypes: ARCHETYPES,
      strategies: fixtureStrategies(),
      onRound: (result) => roundResults.push(result.round),
    });

    expect(roundResults).toEqual([1, 2, 3, 4, 5]);
  }, 15000);

  it('simulation stops on collapse', async () => {
    // High extraction rate + low regen = fast collapse
    const config: GameConfig = {
      poolSize: 100,
      regenerationRate: 0.01,
      maxExtractionRate: 0.50,
      rounds: 50,
      agentCount: 7,
    };

    const log = await runSimulation({
      config,
      archetypes: ARCHETYPES,
      strategies: fixtureStrategies(),
    });

    // Should collapse well before 50 rounds with these params
    expect(log.finalState.collapsed).toBe(true);
    expect(log.rounds.length).toBeLessThan(50);
    expect(log.finalState.collapseRound).not.toBeNull();
  }, 30000);

  it('pool values stay at 2 decimal places throughout', async () => {
    const log = await runSimulation({
      config: DEFAULT_CONFIG,
      archetypes: ARCHETYPES,
      strategies: fixtureStrategies(),
    });

    for (const round of log.rounds) {
      const decimals = round.poolAfter.toString().split('.')[1]?.length ?? 0;
      expect(decimals).toBeLessThanOrEqual(2);
    }
  }, 30000);

});
