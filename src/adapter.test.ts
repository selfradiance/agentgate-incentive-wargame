// Tests for v0.2.0 adapter: observation packet construction and truncation.

import { describe, it, expect } from 'vitest';
import { buildObservationPacket } from './adapter.js';
import type { SimulationLog, AllMetrics, GameConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// --- Helpers ---

function makeSimpleLog(roundCount: number, agentCount: number = 7): SimulationLog {
  const config: GameConfig = { ...DEFAULT_CONFIG, rounds: roundCount, agentCount };
  const rounds = Array.from({ length: roundCount }, (_, i) => {
    const poolBefore = 1000 - i * 10;
    const actual = new Array(agentCount).fill(10);
    const requested = new Array(agentCount).fill(12);
    return {
      round: i + 1,
      poolBefore,
      poolAfter: poolBefore - actual.reduce((s: number, a: number) => s + a, 0),
      requested,
      actual,
      agentWealth: actual.map((a: number) => a * (i + 1)),
      collapsed: false,
    };
  });

  return {
    config,
    archetypes: Array.from({ length: agentCount }, (_, i) => ({
      index: i, name: `Agent${i}`, description: '',
    })),
    strategies: Array.from({ length: agentCount }, (_, i) => ({
      archetypeIndex: i, archetypeName: `Agent${i}`, code: '', isFallback: false,
    })),
    rounds,
    finalState: {
      pool: rounds[rounds.length - 1].poolAfter,
      round: roundCount,
      agentWealth: rounds[rounds.length - 1].agentWealth,
      agentHistory: Array.from({ length: agentCount }, () =>
        rounds.map(r => r.actual[0]),
      ),
      poolHistory: rounds.map(r => r.poolBefore),
      collapsed: false,
      collapseRound: null,
    },
  };
}

function makeSimpleMetrics(): AllMetrics {
  return {
    gini: { gini: 0.1 },
    poolSurvival: { survived: true, completed: true, collapseRound: null },
    agentWealth: [{ archetypeName: 'Agent0', totalWealth: 100 }],
    overExtractionRate: { overExtractionRate: 0.2, overExtractionCount: 5, totalAgentRounds: 70 },
    systemEfficiency: { efficiency: 1.1, totalActualExtraction: 700, totalMSY: 636 },
    resourceHealth: { minPoolFraction: 0.8, avgPoolFraction: 0.9, finalPoolFraction: 0.85 },
    collapseVelocity: { tippingPointRound: null, roundsFromTipToCollapse: null },
    firstOverExtraction: null,
  };
}

// --- Observation Packet ---

describe('buildObservationPacket', () => {
  it('constructs correct packet for agent 0', () => {
    const log = makeSimpleLog(10);
    const metrics = makeSimpleMetrics();
    const packet = buildObservationPacket(0, 1, log, metrics);

    expect(packet.agentIndex).toBe(0);
    expect(packet.runNumber).toBe(1);
    expect(packet.roundCount).toBe(10);
    expect(packet.private.wealthPerRound).toHaveLength(10);
    expect(packet.private.requestedPerRound).toHaveLength(10);
    expect(packet.private.receivedPerRound).toHaveLength(10);
    expect(packet.private.wasRationedPerRound).toHaveLength(10);
    expect(packet.public.poolLevelPerRound).toHaveLength(10);
    expect(packet.public.totalExtractionPerRound).toHaveLength(10);
    expect(packet.public.msyThresholdPerRound).toHaveLength(10);
    expect(packet.public.agentExtractionsPerRound).toHaveLength(10);
  });

  it('detects rationing correctly', () => {
    const log = makeSimpleLog(5);
    // Agent 0 requested 12, received 10 in all rounds
    const metrics = makeSimpleMetrics();
    const packet = buildObservationPacket(0, 1, log, metrics);

    // All rounds should show rationing (requested 12 > received 10)
    for (const wasRationed of packet.private.wasRationedPerRound) {
      expect(wasRationed).toBe(true);
    }
  });

  it('includes metrics in packet', () => {
    const log = makeSimpleLog(5);
    const metrics = makeSimpleMetrics();
    const packet = buildObservationPacket(0, 1, log, metrics);

    expect(packet.metrics.gini).toBe(0.1);
    expect(packet.metrics.collapsed).toBe(false);
    expect(packet.metrics.abuseRate).toBe(0.2);
  });

  it('truncates when rounds > 50', () => {
    const log = makeSimpleLog(60);
    const metrics = makeSimpleMetrics();
    const packet = buildObservationPacket(0, 1, log, metrics);

    expect(packet.truncated).toBeDefined();
    expect(packet.truncated!.omittedRounds.start).toBe(6);
    expect(packet.truncated!.omittedRounds.end).toBe(55);
    // Arrays should be truncated to first 5 + last 5 = 10
    expect(packet.private.wealthPerRound).toHaveLength(10);
    expect(packet.public.poolLevelPerRound).toHaveLength(10);
    expect(packet.public.agentExtractionsPerRound).toHaveLength(10);
  });

  it('does not truncate when rounds <= 50', () => {
    const log = makeSimpleLog(50);
    const metrics = makeSimpleMetrics();
    const packet = buildObservationPacket(0, 1, log, metrics);

    expect(packet.truncated).toBeUndefined();
    expect(packet.private.wealthPerRound).toHaveLength(50);
  });
});
