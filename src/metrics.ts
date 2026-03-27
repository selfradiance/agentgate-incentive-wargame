// Agent 006: Metrics — 8 metrics with concrete formulas

import type {
  SimulationLog,
  GiniResult,
  PoolSurvivalResult,
  AgentWealthResult,
  OverExtractionRateResult,
  SystemEfficiencyResult,
  ResourceHealthResult,
  CollapseVelocityResult,
  FirstOverExtractionResult,
  AllMetrics,
} from './types.js';
import { computeSustainableShare } from './economy.js';

// 1. Gini Coefficient — wealth inequality
export function computeGini(wealth: number[]): GiniResult {
  const n = wealth.length;
  const mean = wealth.reduce((s, w) => s + w, 0) / n;

  if (mean === 0) return { gini: 0 };

  let sumDiffs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumDiffs += Math.abs(wealth[i] - wealth[j]);
    }
  }

  return { gini: Math.round((sumDiffs / (2 * n * n * mean)) * 10000) / 10000 };
}

// 2. Pool Survival
export function computePoolSurvival(log: SimulationLog): PoolSurvivalResult {
  const completed = log.finalState.collapsed || log.rounds.length === log.config.rounds;
  return {
    survived: completed && !log.finalState.collapsed,
    completed,
    collapseRound: log.finalState.collapseRound,
  };
}

// 3. Per-Agent Total Wealth (sorted by wealth descending)
export function computeAgentWealth(log: SimulationLog): AgentWealthResult[] {
  return log.archetypes
    .map((arch, i) => ({
      archetypeName: arch.name,
      totalWealth: log.finalState.agentWealth[i],
    }))
    .sort((a, b) => b.totalWealth - a.totalWealth);
}

// 4. Over-Extraction Rate
export function computeOverExtractionRate(log: SimulationLog): OverExtractionRateResult {
  const roundsPlayed = log.rounds.length;
  if (roundsPlayed === 0) {
    return { overExtractionRate: 0, overExtractionCount: 0, totalAgentRounds: 0 };
  }

  const agentCount = log.config.agentCount;
  let overCount = 0;

  for (const round of log.rounds) {
    const sustainableShare = computeSustainableShare(
      round.poolBefore,
      log.config.regenerationRate,
      agentCount,
    );
    for (let i = 0; i < agentCount; i++) {
      if (round.actual[i] > sustainableShare) {
        overCount++;
      }
    }
  }

  const total = agentCount * roundsPlayed;
  return {
    overExtractionRate: Math.round((overCount / total) * 10000) / 10000,
    overExtractionCount: overCount,
    totalAgentRounds: total,
  };
}

// 5. System Efficiency
export function computeSystemEfficiency(log: SimulationLog): SystemEfficiencyResult {
  if (log.rounds.length === 0) {
    return { efficiency: 0, totalActualExtraction: 0, totalMSY: 0 };
  }

  let totalActual = 0;
  let totalMSY = 0;

  for (const round of log.rounds) {
    const roundActual = round.actual.reduce((s, a) => s + a, 0);
    totalActual += roundActual;
    totalMSY += round.poolBefore * log.config.regenerationRate;
  }

  return {
    efficiency: totalMSY === 0 ? 0 : Math.round((totalActual / totalMSY) * 10000) / 10000,
    totalActualExtraction: Math.round(totalActual * 100) / 100,
    totalMSY: Math.round(totalMSY * 100) / 100,
  };
}

// 6. Resource Health Trajectory
export function computeResourceHealth(log: SimulationLog): ResourceHealthResult {
  if (log.rounds.length === 0) {
    return { minPoolFraction: 1, avgPoolFraction: 1, finalPoolFraction: 1 };
  }

  const startingPool = log.config.poolSize;
  const poolLevels = log.rounds.map(r => r.poolAfter);

  const min = Math.min(...poolLevels);
  const avg = poolLevels.reduce((s, p) => s + p, 0) / poolLevels.length;
  const final = poolLevels[poolLevels.length - 1];

  return {
    minPoolFraction: Math.round((min / startingPool) * 10000) / 10000,
    avgPoolFraction: Math.round((avg / startingPool) * 10000) / 10000,
    finalPoolFraction: Math.round((final / startingPool) * 10000) / 10000,
  };
}

// 7. Collapse Velocity
export function computeCollapseVelocity(log: SimulationLog): CollapseVelocityResult {
  // Find tipping point: first round where total extraction > that round's MSY
  let tippingPointRound: number | null = null;

  for (const round of log.rounds) {
    const msy = round.poolBefore * log.config.regenerationRate;
    const totalExtraction = round.actual.reduce((s, a) => s + a, 0);
    if (totalExtraction > msy) {
      tippingPointRound = round.round;
      break;
    }
  }

  if (tippingPointRound === null) {
    return { tippingPointRound: null, roundsFromTipToCollapse: null };
  }

  if (!log.finalState.collapsed || log.finalState.collapseRound === null) {
    return { tippingPointRound, roundsFromTipToCollapse: null };
  }

  return {
    tippingPointRound,
    roundsFromTipToCollapse: log.finalState.collapseRound - tippingPointRound,
  };
}

// 8. First Over-Extraction Event
export function computeFirstOverExtraction(log: SimulationLog): FirstOverExtractionResult | null {
  for (const round of log.rounds) {
    const sustainableShare = computeSustainableShare(
      round.poolBefore,
      log.config.regenerationRate,
      log.config.agentCount,
    );
    for (let i = 0; i < log.config.agentCount; i++) {
      if (round.actual[i] > sustainableShare) {
        return {
          round: round.round,
          agentIndex: i,
          archetypeName: log.archetypes[i].name,
          amount: round.actual[i],
          sustainableShare,
        };
      }
    }
  }
  return null;
}

// Compute all 8 metrics
export function computeAllMetrics(log: SimulationLog): AllMetrics {
  return {
    gini: computeGini(log.finalState.agentWealth),
    poolSurvival: computePoolSurvival(log),
    agentWealth: computeAgentWealth(log),
    overExtractionRate: computeOverExtractionRate(log),
    systemEfficiency: computeSystemEfficiency(log),
    resourceHealth: computeResourceHealth(log),
    collapseVelocity: computeCollapseVelocity(log),
    firstOverExtraction: computeFirstOverExtraction(log),
  };
}
