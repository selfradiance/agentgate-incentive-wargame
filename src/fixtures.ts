// Agent 006: Hand-Written Fixture Strategies
// Deterministic implementations of the 7 archetypes for engine testing
// and reproducible canonical runs (--fixtures mode).

import type { StrategyState } from './types.js';

// 0: Greedy — always extracts the maximum allowed
export function greedy(state: StrategyState): number {
  return state.maxExtraction;
}

// 1: Cooperative — extracts only sustainable share
export function cooperative(state: StrategyState): number {
  return Math.min(state.sustainableShare, state.maxExtraction);
}

// 2: Retaliator — grim trigger: cooperative until anyone over-extracts, then max forever
export function retaliator(state: StrategyState): number {
  if (state.round === 1) {
    return Math.min(state.sustainableShare, state.maxExtraction);
  }

  // Check all prior rounds — grim trigger is permanent
  for (let r = 0; r < state.allHistory[0].length; r++) {
    const poolAtRound = state.poolHistory[r];
    const shareAtRound = Math.round((poolAtRound * state.regenerationRate / state.agentCount) * 100) / 100;
    for (let a = 0; a < state.agentCount; a++) {
      if (state.allHistory[a][r] > shareAtRound) {
        return state.maxExtraction;
      }
    }
  }

  return Math.min(state.sustainableShare, state.maxExtraction);
}

// 3: Forgiver — tit-for-tat with de-escalation
// Checks OTHER agents only (excludes self) so its own punishment doesn't block de-escalation
export function forgiver(state: StrategyState): number {
  if (state.round === 1) {
    return Math.min(state.sustainableShare, state.maxExtraction);
  }

  // Check last round for over-extraction by OTHER agents
  const lastPoolLevel = state.poolHistory[state.poolHistory.length - 1];
  const lastSustainableShare = Math.round((lastPoolLevel * state.regenerationRate / state.agentCount) * 100) / 100;

  let anyOtherOverExtracted = false;
  for (let a = 0; a < state.agentCount; a++) {
    if (a === state.agentIndex) continue; // exclude self
    if (state.allHistory[a][state.allHistory[a].length - 1] > lastSustainableShare) {
      anyOtherOverExtracted = true;
      break;
    }
  }

  if (anyOtherOverExtracted) {
    return state.maxExtraction;
  }

  // No other agent over-extracted last round → cooperate
  return Math.min(state.sustainableShare, state.maxExtraction);
}

// 4: Opportunist — cooperates while pool > 50%, max extraction below that
export function opportunist(state: StrategyState): number {
  if (state.poolLevel / state.startingPoolSize < 0.5) {
    return state.maxExtraction;
  }
  return Math.min(state.sustainableShare, state.maxExtraction);
}

// 5: Adaptive — watches 3-round pool trend, scales extraction with decline
export function adaptive(state: StrategyState): number {
  if (state.round <= 3) {
    return Math.min(state.sustainableShare, state.maxExtraction);
  }

  const recent = state.poolHistory.slice(-3);
  const trend = recent[2] - recent[0]; // positive = growing, negative = declining

  if (trend >= 0) {
    // Pool growing or stable — extract sustainable share
    return Math.min(state.sustainableShare, state.maxExtraction);
  }

  // Pool declining — increase extraction proportional to decline rate
  const declineRate = Math.abs(trend) / recent[0];
  const increased = state.sustainableShare * (1 + declineRate);
  return Math.min(increased, state.maxExtraction);
}

// 6: Stabilizer — extracts exactly what keeps the pool at current level
export function stabilizer(state: StrategyState): number {
  // To keep pool stable: extract = pool * regenerationRate / agentCount
  // This is the same as sustainableShare
  return Math.min(state.poolLevel * state.regenerationRate / state.agentCount, state.maxExtraction);
}

export const FIXTURE_STRATEGIES = [
  greedy,
  cooperative,
  retaliator,
  forgiver,
  opportunist,
  adaptive,
  stabilizer,
];
