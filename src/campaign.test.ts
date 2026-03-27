// Tests for v0.2.0 campaign loop, CLI flags, and fixture-adaptation.

import { describe, it, expect } from 'vitest';
import { runCampaign } from './runner.js';
import { ARCHETYPES } from './archetypes.js';
import { FIXTURE_STRATEGIES } from './fixtures.js';
import { fixtureAdaptAllStrategies } from './fixtures-adaptation.js';
import { parseAndValidateArgs } from './cli.js';
import type { Strategy, GameConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// --- Helpers ---

function fixtureStrategies(): Strategy[] {
  return FIXTURE_STRATEGIES.map((fn, i) => ({
    archetypeIndex: i,
    archetypeName: ARCHETYPES[i].name,
    code: fn.toString(),
    isFallback: false,
  }));
}

const quickConfig: GameConfig = {
  ...DEFAULT_CONFIG,
  rounds: 5,
};

// --- CLI Flag Tests ---

describe('CLI --runs flag', () => {
  it('defaults to 3 runs', () => {
    const flags = parseAndValidateArgs([]);
    expect(flags.runs).toBe(3);
  });

  it('accepts valid --runs value', () => {
    const flags = parseAndValidateArgs(['--runs', '5']);
    expect(flags.runs).toBe(5);
  });

  it('rejects --runs > 10', () => {
    expect(() => parseAndValidateArgs(['--runs', '11']))
      .toThrow(/Invalid --runs value/);
  });

  it('rejects --runs < 1', () => {
    expect(() => parseAndValidateArgs(['--runs', '0']))
      .toThrow(/Invalid --runs value/);
  });

  it('rejects non-integer --runs', () => {
    expect(() => parseAndValidateArgs(['--runs', '2.5']))
      .toThrow(/Invalid --runs value/);
  });

  it('rejects --fixtures with --runs > 1', () => {
    expect(() => parseAndValidateArgs(['--fixtures', '--runs', '3']))
      .toThrow(/mutually exclusive/);
  });

  it('allows --fixtures with --runs 1 (default single run)', () => {
    const flags = parseAndValidateArgs(['--fixtures', '--runs', '1']);
    expect(flags.fixtures).toBe(true);
    expect(flags.runs).toBe(1);
  });
});

// --- Campaign Loop Tests ---

describe('runCampaign — fixture-adaptation integration', () => {
  it('runs a 2-run campaign with fixture adaptation', async () => {
    const result = await runCampaign({
      config: quickConfig,
      archetypes: ARCHETYPES,
      initialStrategies: fixtureStrategies(),
      totalRuns: 2,
      adaptFn: fixtureAdaptAllStrategies,
    });

    expect(result.aborted).toBe(false);
    expect(result.runs).toHaveLength(2);

    // Run 1: no drift (first run)
    expect(result.runs[0].drift).toBeUndefined();
    expect(result.runs[0].runNumber).toBe(1);

    // Run 2: should have drift
    expect(result.runs[1].drift).toBeDefined();
    expect(result.runs[1].drift!.average).toBeGreaterThanOrEqual(0);
    expect(result.runs[1].runNumber).toBe(2);

    // Both runs should have convergence
    expect(result.runs[0].convergence.score).toBeGreaterThanOrEqual(0);
    expect(result.runs[1].convergence.score).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('runs a 3-run campaign', async () => {
    const result = await runCampaign({
      config: quickConfig,
      archetypes: ARCHETYPES,
      initialStrategies: fixtureStrategies(),
      totalRuns: 3,
      adaptFn: fixtureAdaptAllStrategies,
    });

    expect(result.aborted).toBe(false);
    expect(result.runs).toHaveLength(3);
    expect(result.resilienceTrend.points).toHaveLength(3);
    expect(['positive', 'negative', 'flat']).toContain(result.resilienceTrend.trend);
  }, 45000);

  it('computes resilience trend across runs', async () => {
    const result = await runCampaign({
      config: quickConfig,
      archetypes: ARCHETYPES,
      initialStrategies: fixtureStrategies(),
      totalRuns: 2,
      adaptFn: fixtureAdaptAllStrategies,
    });

    expect(result.resilienceTrend.points).toHaveLength(2);
    for (const point of result.resilienceTrend.points) {
      expect(point.survivalRounds).toBeGreaterThan(0);
      expect(point.finalPoolHealth).toBeGreaterThanOrEqual(0);
    }
  }, 30000);

  it('fires callbacks', async () => {
    const events: string[] = [];

    await runCampaign({
      config: quickConfig,
      archetypes: ARCHETYPES,
      initialStrategies: fixtureStrategies(),
      totalRuns: 2,
      adaptFn: fixtureAdaptAllStrategies,
      onRunStart: (n) => events.push(`start-${n}`),
      onRunEnd: (n) => events.push(`end-${n}`),
      onAdaptStart: (n) => events.push(`adapt-start-${n}`),
      onAdaptEnd: (n) => events.push(`adapt-end-${n}`),
    });

    expect(events).toContain('start-1');
    expect(events).toContain('end-1');
    expect(events).toContain('adapt-start-2');
    expect(events).toContain('adapt-end-2');
    expect(events).toContain('start-2');
    expect(events).toContain('end-2');
  }, 30000);

  it('aborts campaign when adaptation fails for >= 2 agents', async () => {
    // Adapter that always fails
    const failingAdapter = async () => ({
      strategies: fixtureStrategies(),
      results: ARCHETYPES.map((a, i) => ({
        agentIndex: i,
        archetypeName: a.name,
        newStrategy: null,
        usedFallback: true,
        validationFailed: true,
        error: 'forced failure',
      })),
      failureCount: 7,
    });

    const result = await runCampaign({
      config: quickConfig,
      archetypes: ARCHETYPES,
      initialStrategies: fixtureStrategies(),
      totalRuns: 3,
      adaptFn: failingAdapter,
    });

    expect(result.aborted).toBe(true);
    expect(result.abortReason).toContain('7 agents failed');
    expect(result.runs).toHaveLength(1); // Only Run 1 completed
  }, 30000);
});

// --- Fixture Adaptation ---

describe('fixtureAdaptAllStrategies', () => {
  it('returns adapted strategies for Run 2', async () => {
    const log = (await import('./runner.js')).runSimulation;
    const result = await fixtureAdaptAllStrategies(
      ARCHETYPES,
      fixtureStrategies(),
      { config: quickConfig, archetypes: ARCHETYPES, strategies: fixtureStrategies(), rounds: [], finalState: { pool: 900, round: 5, agentWealth: [100,100,100,100,100,100,100], agentHistory: Array.from({length:7}, () => [20,20,20,20,20]), poolHistory: [1000,980,960,940,920], collapsed: false, collapseRound: null } },
      { gini: { gini: 0 }, poolSurvival: { survived: true, completed: true, collapseRound: null }, agentWealth: [], overExtractionRate: { overExtractionRate: 0, overExtractionCount: 0, totalAgentRounds: 35 }, systemEfficiency: { efficiency: 1, totalActualExtraction: 700, totalMSY: 500 }, resourceHealth: { minPoolFraction: 0.9, avgPoolFraction: 0.95, finalPoolFraction: 0.92 }, collapseVelocity: { tippingPointRound: null, roundsFromTipToCollapse: null }, firstOverExtraction: null },
      1,
      quickConfig,
    );

    expect(result.failureCount).toBe(0);
    expect(result.strategies).toHaveLength(7);
    // All strategies should be different from originals (adapted)
    for (let i = 0; i < 7; i++) {
      expect(result.results[i].usedFallback).toBe(false);
      expect(result.strategies[i].code).toContain('Adapted');
    }
  });

  it('returns adapted strategies for Run 3', async () => {
    const result = await fixtureAdaptAllStrategies(
      ARCHETYPES,
      fixtureStrategies(),
      { config: quickConfig, archetypes: ARCHETYPES, strategies: fixtureStrategies(), rounds: [], finalState: { pool: 900, round: 5, agentWealth: [100,100,100,100,100,100,100], agentHistory: Array.from({length:7}, () => [20,20,20,20,20]), poolHistory: [1000,980,960,940,920], collapsed: false, collapseRound: null } },
      { gini: { gini: 0 }, poolSurvival: { survived: true, completed: true, collapseRound: null }, agentWealth: [], overExtractionRate: { overExtractionRate: 0, overExtractionCount: 0, totalAgentRounds: 35 }, systemEfficiency: { efficiency: 1, totalActualExtraction: 700, totalMSY: 500 }, resourceHealth: { minPoolFraction: 0.9, avgPoolFraction: 0.95, finalPoolFraction: 0.92 }, collapseVelocity: { tippingPointRound: null, roundsFromTipToCollapse: null }, firstOverExtraction: null },
      2,
      quickConfig,
    );

    expect(result.failureCount).toBe(0);
    expect(result.strategies).toHaveLength(7);
  });
});
