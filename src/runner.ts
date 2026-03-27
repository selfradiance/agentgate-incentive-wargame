// Agent 006: Simulation Runner + Campaign Loop (v0.2.0)
// Single run: round loop with sandbox execution.
// Campaign: multiple runs with adapter-driven strategy adaptation between runs.

import type {
  GameConfig,
  SimulationLog,
  RoundResult,
  Strategy,
  Archetype,
  AllMetrics,
  CampaignResult,
  RunResult,
  CanonicalState,
} from './types.js';
import {
  computeMaxExtraction,
  computeSustainableShare,
  createEconomyState,
  processRound,
} from './economy.js';
import { RoundDispatcher, normalizeExtraction } from './sandbox/executor.js';
import { computeAllMetrics } from './metrics.js';
import {
  buildCanonicalStateBattery,
  extractRunSnapshots,
  computeStrategyDrift,
  computeBehavioralConvergence,
  computeResilienceTrend,
  detectAdaptationTheater,
  detectArchetypeCollapse,
} from './metrics.js';
import type { AdaptAllResult } from './adapter.js';

// --- Single Simulation Run (unchanged from v0.1.0) ---

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

// --- v0.2.0: Campaign Loop ---

export interface CampaignOptions {
  config: GameConfig;
  archetypes: Archetype[];
  initialStrategies: Strategy[];
  totalRuns: number;
  adaptFn: (
    archetypes: Archetype[],
    priorStrategies: Strategy[],
    log: SimulationLog,
    metrics: AllMetrics,
    runNumber: number,
    config: GameConfig,
  ) => Promise<AdaptAllResult>;
  onRunStart?: (runNumber: number) => void;
  onRound?: (runNumber: number, result: RoundResult) => void;
  onRunEnd?: (runNumber: number, log: SimulationLog, metrics: AllMetrics) => void;
  onAdaptStart?: (runNumber: number) => void;
  onAdaptEnd?: (runNumber: number, result: AdaptAllResult) => void;
}

export async function runCampaign(opts: CampaignOptions): Promise<CampaignResult> {
  const { config, archetypes, totalRuns, adaptFn } = opts;

  let strategies = opts.initialStrategies;
  const allRunResults: RunResult[] = [];
  const canonicalStates = buildCanonicalStateBattery(config);

  for (let run = 1; run <= totalRuns; run++) {
    // Adaptation phase (runs 2+)
    let priorStrategies: Strategy[] | undefined;
    if (run > 1) {
      const priorResult = allRunResults[run - 2];

      opts.onAdaptStart?.(run);

      const adaptResult = await adaptFn(
        archetypes,
        strategies,
        priorResult.log,
        priorResult.metrics,
        run - 1,  // runNumber = which run just completed
        config,
      );

      opts.onAdaptEnd?.(run, adaptResult);

      // Abort if >= 2 failures
      if (adaptResult.failureCount >= 2) {
        return {
          runs: allRunResults,
          resilienceTrend: computeResilienceTrend(allRunResults),
          adaptationTheater: detectAdaptationTheater(allRunResults),
          archetypeCollapse: detectArchetypeCollapse(allRunResults),
          aborted: true,
          abortReason: `Campaign aborted: ${adaptResult.failureCount} agents failed adaptation in run ${run} (threshold: 2).`,
        };
      }

      priorStrategies = strategies;
      strategies = adaptResult.strategies;
    }

    // Run simulation
    opts.onRunStart?.(run);

    const log = await runSimulation({
      config,
      archetypes,
      strategies,
      onRound: opts.onRound ? (result) => opts.onRound!(run, result) : undefined,
    });

    const metrics = computeAllMetrics(log);

    opts.onRunEnd?.(run, log, metrics);

    // Compute campaign metrics
    const augmentedBattery: CanonicalState[] = [...canonicalStates];
    if (run > 1) {
      const priorLog = allRunResults[run - 2].log;
      augmentedBattery.push(...extractRunSnapshots(priorLog));
    }

    const drift = (run > 1 && priorStrategies)
      ? computeStrategyDrift(priorStrategies, strategies, augmentedBattery)
      : undefined;

    const convergence = computeBehavioralConvergence(strategies, augmentedBattery);

    const runResult: RunResult = {
      runNumber: run,
      log,
      metrics,
      strategies: [...strategies],
      drift,
      convergence,
      adaptationResults: run > 1 ? allRunResults[run - 2]?.adaptationResults : undefined,
    };

    allRunResults.push(runResult);
  }

  return {
    runs: allRunResults,
    resilienceTrend: computeResilienceTrend(allRunResults),
    adaptationTheater: detectAdaptationTheater(allRunResults),
    archetypeCollapse: detectArchetypeCollapse(allRunResults),
    aborted: false,
  };
}
