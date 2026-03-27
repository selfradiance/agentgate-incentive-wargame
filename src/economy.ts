// Agent 006: Economy Engine
// Pool tracking, extraction processing, pro-rata rationing, regeneration,
// carrying capacity, collapse detection.

import type { GameConfig, EconomyState, RoundResult } from './types.js';

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  state.round += 1;
  state.poolHistory.push(poolBefore);

  // Pro-rata rationing
  const totalRequested = requested.reduce((sum, r) => sum + r, 0);
  let actual: number[];

  if (totalRequested <= poolBefore) {
    // Everyone gets what they asked for
    actual = requested.map(r => r);
  } else {
    // Distribute pro-rata using Math.floor truncation
    actual = requested.map(r =>
      Math.floor((r / totalRequested) * poolBefore * 100) / 100
    );
  }

  // Deduct extractions from pool
  const totalActual = actual.reduce((sum, a) => sum + a, 0);
  state.pool = round2(poolBefore - totalActual);

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
