// Agent 006: Economy Engine
// Pool tracking, extraction processing, pro-rata rationing, regeneration,
// carrying capacity, collapse detection.

import type { GameConfig, EconomyState, RoundResult } from './types.js';

function toCents(n: number): number {
  return Math.round(n * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

export function createEconomyState(config: GameConfig): EconomyState {
  return {
    pool: config.poolSize,
    round: 0,
    agentWealth: new Array(config.agentCount).fill(0),
    agentHistory: Array.from({ length: config.agentCount }, () => []),
    poolHistory: [],
    collapsed: false,
    collapseRound: null,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeMaxExtraction(poolLevel: number, maxExtractionRate: number): number {
  return round2(poolLevel * maxExtractionRate);
}

export function computeSustainableShare(
  poolLevel: number,
  regenerationRate: number,
  agentCount: number,
): number {
  return round2(poolLevel * regenerationRate / agentCount);
}

/**
 * Process one round of extraction.
 *
 * Takes raw extraction requests (already clamped/normalized by caller),
 * applies pro-rata rationing if total exceeds pool, then regeneration,
 * carrying capacity cap, and collapse check.
 */
export function processRound(
  state: EconomyState,
  requested: number[],
  config: GameConfig,
): RoundResult {
  const poolBefore = state.pool;
  const poolBeforeCents = toCents(poolBefore);
  state.round += 1;
  state.poolHistory.push(poolBefore);

  // Pro-rata rationing
  const requestedCents = requested.map(toCents);
  const totalRequestedCents = requestedCents.reduce((sum, r) => sum + r, 0);
  let actual: number[];

  if (totalRequestedCents <= poolBeforeCents) {
    // Everyone gets what they asked for
    actual = requestedCents.map(fromCents);
  } else {
    // Distribute pro-rata using cent-level floor truncation so the pool is never overspent.
    actual = requestedCents.map(requestedAmountCents =>
      fromCents(Math.floor((requestedAmountCents * poolBeforeCents) / totalRequestedCents))
    );
  }

  // Deduct extractions from pool
  const totalActualCents = actual.reduce((sum, amount) => sum + toCents(amount), 0);
  state.pool = fromCents(poolBeforeCents - totalActualCents);

  // Update agent wealth and history
  for (let i = 0; i < actual.length; i++) {
    state.agentWealth[i] = round2(state.agentWealth[i] + actual[i]);
    state.agentHistory[i].push(actual[i]);
  }

  // Regeneration
  state.pool = round2(state.pool + state.pool * config.regenerationRate);

  // Carrying capacity cap
  state.pool = Math.min(state.pool, config.poolSize);

  // Round to 2 decimal places
  state.pool = round2(state.pool);

  // Collapse check
  if (state.pool < 0.01) {
    state.collapsed = true;
    state.collapseRound = state.round;
  }

  return {
    round: state.round,
    poolBefore,
    poolAfter: state.pool,
    requested,
    actual,
    agentWealth: [...state.agentWealth],
    collapsed: state.collapsed,
  };
}
