// Agent 006: Simulation Runner
// Round loop: build state → send to child → parent timeout → collect extractions →
// normalize → feed to economy engine → record results → check collapse.

import type { GameConfig, SimulationLog, RoundResult, Strategy, Archetype } from './types.js';
import {
  computeMaxExtraction,
  computeSustainableShare,
  createEconomyState,
  processRound,
} from './economy.js';
import { RoundDispatcher, normalizeExtraction } from './sandbox/executor.js';

export interface RunnerOptions {
  config: GameConfig;
  archetypes: Archetype[];
  strategies: Strategy[];
  onRound?: (result: RoundResult) => void;
}

export async function runSimulation(opts: RunnerOptions): Promise<SimulationLog> {
  const { config, archetypes, strategies } = opts;
  const economyState = createEconomyState(config);
  const rounds: RoundResult[] = [];
  const strategyCodes = strategies.map(s => s.code);

  const dispatcher = new RoundDispatcher();
  await dispatcher.spawn();

  try {
    for (let r = 1; r <= config.rounds; r++) {
      if (economyState.collapsed) break;

      const maxExtraction = computeMaxExtraction(economyState.pool, config.maxExtractionRate);
      const sustainableShare = computeSustainableShare(
        economyState.pool,
        config.regenerationRate,
        config.agentCount,
      );

      // Build state object for the child
      const state = {
        round: r,
        totalRounds: config.rounds,
        poolLevel: economyState.pool,
        startingPoolSize: config.poolSize,
        regenerationRate: config.regenerationRate,
        maxExtraction,
        agentCount: config.agentCount,
        agentWealth: [...economyState.agentWealth],
        agentHistory: economyState.agentHistory.map(h => [...h]),
        poolHistory: [...economyState.poolHistory],
        sustainableShare,
      };

      // Dispatch to child process
      const dispatchResult = await dispatcher.executeRound(strategyCodes, state);

      if (dispatchResult.timedOut) {
        console.error(`[Round ${r}] Timeout — all agents get 0 extraction. Child respawned.`);
      }
      if (dispatchResult.childCrashed) {
        console.error(`[Round ${r}] Child process crashed. Reporting partial results.`);
        break;
      }

      // Normalize extractions
      const requested: number[] = [];
      for (let i = 0; i < config.agentCount; i++) {
        const raw = dispatchResult.extractions[i];
        const normalized = normalizeExtraction(raw, maxExtraction);
        if (normalized.error) {
          console.error(`[Round ${r}] Agent ${i} (${archetypes[i].name}) error: ${normalized.error}`);
        }
        requested.push(normalized.value);
      }

      // Process through economy engine
      const roundResult = processRound(economyState, requested, config);
      rounds.push(roundResult);

      if (opts.onRound) {
        opts.onRound(roundResult);
      }
    }
  } finally {
    dispatcher.kill();
  }

  return {
    config,
    archetypes,
    strategies,
    rounds,
    finalState: {
      ...economyState,
      agentWealth: [...economyState.agentWealth],
      agentHistory: economyState.agentHistory.map(history => [...history]),
      poolHistory: [...economyState.poolHistory],
    },
  };
}
