// Agent 006: Simulation Runner + Campaign Loop (v0.2.0 + v0.3.0)
// Single run: round loop with sandbox execution.
// Campaign: multiple runs with adapter-driven strategy adaptation between runs.
// v0.3.0: Scenario-aware runner using generated economy modules in sandbox.

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
  NormalizedScenario,
  AgentDecision,
  HardInvariantViolation,
} from './types.js';
import {
  computeMaxExtraction,
  computeSustainableShare,
  createEconomyState,
  processRound,
} from './economy.js';
import { RoundDispatcher, normalizeExtraction, validateStrategy } from './sandbox/executor.js';
import { validateDecision } from './sandbox/validator.js';
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

function buildAbortedCampaign(runs: RunResult[], reason: string): CampaignResult {
  return {
    runs,
    resilienceTrend: computeResilienceTrend(runs),
    adaptationTheater: detectAdaptationTheater(runs),
    archetypeCollapse: detectArchetypeCollapse(runs),
    aborted: true,
    abortReason: reason,
  };
}

function validateExecutionInputs(
  config: GameConfig,
  archetypes: Archetype[],
  strategies: Strategy[],
): void {
  if (!Number.isInteger(config.rounds) || config.rounds < 1) {
    throw new Error(`Invalid config.rounds: ${config.rounds}`);
  }
  if (!Number.isInteger(config.agentCount) || config.agentCount < 1) {
    throw new Error(`Invalid config.agentCount: ${config.agentCount}`);
  }
  if (!Number.isFinite(config.poolSize) || config.poolSize <= 0) {
    throw new Error(`Invalid config.poolSize: ${config.poolSize}`);
  }
  if (!Number.isFinite(config.regenerationRate) || config.regenerationRate < 0 || config.regenerationRate > 1) {
    throw new Error(`Invalid config.regenerationRate: ${config.regenerationRate}`);
  }
  if (!Number.isFinite(config.maxExtractionRate) || config.maxExtractionRate < 0 || config.maxExtractionRate > 1) {
    throw new Error(`Invalid config.maxExtractionRate: ${config.maxExtractionRate}`);
  }
  if (archetypes.length !== config.agentCount) {
    throw new Error(`Archetype count ${archetypes.length} does not match config.agentCount ${config.agentCount}`);
  }
  if (strategies.length !== config.agentCount) {
    throw new Error(`Strategy count ${strategies.length} does not match config.agentCount ${config.agentCount}`);
  }

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    if (typeof strategy.code !== 'string') {
      throw new Error(`Strategy ${i} is missing source code`);
    }

    const validation = validateStrategy(strategy.code);
    if (!validation.valid) {
      throw new Error(
        `Strategy ${i} (${strategy.archetypeName}) failed validation: ${validation.errors.join('; ')}`
      );
    }
  }
}

export async function runSimulation(opts: RunnerOptions): Promise<SimulationLog> {
  const { config, archetypes, strategies } = opts;
  validateExecutionInputs(config, archetypes, strategies);
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
  if (!Number.isInteger(totalRuns) || totalRuns < 1) {
    throw new Error(`Invalid totalRuns: ${totalRuns}`);
  }
  validateExecutionInputs(config, archetypes, opts.initialStrategies);

  let strategies = opts.initialStrategies;
  const allRunResults: RunResult[] = [];
  const canonicalStates = buildCanonicalStateBattery(config);

  for (let run = 1; run <= totalRuns; run++) {
    // Adaptation phase (runs 2+)
    let priorStrategies: Strategy[] | undefined;
    let currentAdaptationResults: import('./types.js').AdaptationResult[] | undefined;
    if (run > 1) {
      const priorResult = allRunResults[run - 2];

      opts.onAdaptStart?.(run);

      let adaptResult: AdaptAllResult;
      try {
        adaptResult = await adaptFn(
          archetypes,
          strategies,
          priorResult.log,
          priorResult.metrics,
          run - 1,  // runNumber = which run just completed
          config,
        );
      } catch (err) {
        return buildAbortedCampaign(
          allRunResults,
          `Campaign aborted: adaptation failed before run ${run} — ${(err as Error).message}`,
        );
      }

      opts.onAdaptEnd?.(run, adaptResult);

      // Abort if >= 2 failures
      if (adaptResult.failureCount >= 2) {
        return buildAbortedCampaign(
          allRunResults,
          `Campaign aborted: ${adaptResult.failureCount} agents failed adaptation in run ${run} (threshold: 2).`,
        );
      }

      priorStrategies = strategies;
      strategies = adaptResult.strategies;
      currentAdaptationResults = adaptResult.results;
      validateExecutionInputs(config, archetypes, strategies);
    }

    // Compute campaign metrics
    const augmentedBattery: CanonicalState[] = [...canonicalStates];
    if (run > 1) {
      const priorLog = allRunResults[run - 2].log;
      augmentedBattery.push(...extractRunSnapshots(priorLog));
    }

    let drift: RunResult['drift'];
    let convergence: RunResult['convergence'];
    try {
      drift = (run > 1 && priorStrategies)
        ? await computeStrategyDrift(priorStrategies, strategies, augmentedBattery)
        : undefined;
      convergence = await computeBehavioralConvergence(strategies, augmentedBattery);
    } catch (err) {
      return buildAbortedCampaign(
        allRunResults,
        `Campaign aborted: failed to evaluate behavioral metrics before run ${run} — ${(err as Error).message}`,
      );
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

    const runResult: RunResult = {
      runNumber: run,
      log,
      metrics,
      strategies: [...strategies],
      drift,
      convergence,
      adaptationResults: currentAdaptationResults,
    };

    allRunResults.push(runResult);

    if (!metrics.poolSurvival.completed) {
      return buildAbortedCampaign(
        allRunResults,
        `Campaign aborted: run ${run} ended early after ${log.rounds.length}/${config.rounds} rounds.`,
      );
    }
  }

  return {
    runs: allRunResults,
    resilienceTrend: computeResilienceTrend(allRunResults),
    adaptationTheater: detectAdaptationTheater(allRunResults),
    archetypeCollapse: detectArchetypeCollapse(allRunResults),
    aborted: false,
  };
}

// --- v0.3.0: Scenario-Aware Runner ---

export interface ScenarioRunnerOptions {
  scenario: NormalizedScenario;
  economyCode: string;
  archetypes: Archetype[];
  strategies: Strategy[];
  rounds: number;
  onRound?: (round: number, state: Record<string, unknown>, metrics: Record<string, number>) => void;
}

export interface ScenarioRunResult {
  rounds: number;
  finalState: Record<string, unknown>;
  metricsPerRound: Record<string, number>[];
  softViolations: string[];
  hardViolations: HardInvariantViolation[];
  collapsed: boolean;
  collapseRound: number | null;
  invalidDecisions: { round: number; agentIndex: number; errors: string[] }[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumberRecord(value: unknown): value is Record<string, number> {
  return isPlainObject(value)
    && Object.values(value).every(entry => typeof entry === 'number' && Number.isFinite(entry));
}

function checkHardInvariants(
  state: unknown,
  round: number,
  agentCount: number,
): HardInvariantViolation[] {
  const violations: HardInvariantViolation[] = [];

  if (!isPlainObject(state)) {
    violations.push({
      round,
      type: 'missing-field',
      details: 'Economy state must be a plain object root',
    });
    return violations;
  }

  if (!Number.isInteger(state.round) || (state.round as number) < 0) {
    violations.push({
      round,
      type: 'missing-field',
      details: 'Economy state.round must be a non-negative integer',
    });
  }

  // Deep check for NaN/Infinity in state values
  // Note: JSON.stringify turns NaN → null, so we always walk the state tree
  const checkValue = (val: unknown, path: string) => {
    if (val === null || val === undefined) return;
    if (typeof val === 'number' && !Number.isFinite(val)) {
      violations.push({ round, type: 'nan-detected', details: `${path} = ${val}` });
    }
    if (typeof val === 'object' && val !== null) {
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        checkValue(v, `${path}.${k}`);
      }
    }
  };
  checkValue(state, 'state');

  // Check agent arrays have correct length
  for (const [key, val] of Object.entries(state)) {
    if (Array.isArray(val) && key.toLowerCase().includes('agent') && val.length !== agentCount) {
      violations.push({
        round,
        type: 'wrong-agent-count',
        details: `state.${key} has ${val.length} elements, expected ${agentCount}`,
      });
    }
  }

  return violations;
}

export async function runScenarioSimulation(opts: ScenarioRunnerOptions): Promise<ScenarioRunResult> {
  const { scenario, economyCode, archetypes, strategies, rounds } = opts;

  const dispatcher = new RoundDispatcher();
  await dispatcher.spawn();

  try {
    // Load economy module
    const loadResult = await dispatcher.loadEconomy(economyCode);
    if (!loadResult.success) {
      throw new Error(`Failed to load economy module: ${loadResult.error}`);
    }

    // Initialize state
    const initResult = await dispatcher.callEconomyFunction('initState', [scenario]);
    if (!initResult.success) {
      throw new Error(`Failed to initialize economy state: ${initResult.error}`);
    }

    const initHardViolations = checkHardInvariants(initResult.result, 0, scenario.agentCount);
    if (initHardViolations.length > 0) {
      throw new Error(initHardViolations.map(v => v.details).join('; '));
    }

    let state = initResult.result as Record<string, unknown>;
    const metricsPerRound: Record<string, number>[] = [];
    const softViolations: string[] = [];
    const hardViolations: HardInvariantViolation[] = [];
    const invalidDecisions: ScenarioRunResult['invalidDecisions'] = [];
    let collapsed = false;
    let collapseRound: number | null = null;

    const strategyCodes = strategies.map(s => s.code);

    for (let r = 1; r <= rounds; r++) {
      if (collapsed) break;

      // Get observations for all agents
      const observations: Record<string, unknown>[] = [];
      for (let i = 0; i < scenario.agentCount; i++) {
        const obsResult = await dispatcher.callEconomyFunction('getObservations', [state, i, scenario]);
        if (obsResult.success && isPlainObject(obsResult.result)) {
          const obs = { ...obsResult.result };
          // Inject round/totalRounds for strategy context
          obs._round = r;
          obs._totalRounds = rounds;
          observations.push(obs);
        } else {
          observations.push({
            _round: r,
            _totalRounds: rounds,
            agentIndex: i,
          });
        }
      }

      // Execute strategies in sandbox
      const stratResult = await dispatcher.executeScenarioStrategies(
        strategyCodes,
        observations,
        scenario as unknown as Record<string, unknown>,
      );

      // Validate decisions against schema
      const validatedDecisions: (AgentDecision | null)[] = [];

      for (let i = 0; i < scenario.agentCount; i++) {
        const raw = stratResult.decisions[i];

        if (raw && 'error' in raw) {
          // Strategy error — treat as no-op
          invalidDecisions.push({ round: r, agentIndex: i, errors: [raw.error as string] });
          validatedDecisions.push(makeNoOpDecision());
          continue;
        }

        // Pass agent role from observations if available (economy module sets _role field)
        const agentRole = typeof observations[i]?._role === 'string' ? observations[i]._role as string : undefined;
        const validation = validateDecision(raw, scenario, i, agentRole);
        if (!validation.valid) {
          invalidDecisions.push({ round: r, agentIndex: i, errors: validation.errors });
          validatedDecisions.push(makeNoOpDecision());
        } else {
          validatedDecisions.push(raw as unknown as AgentDecision);
        }
      }

      // Tick economy
      const tickResult = await dispatcher.callEconomyFunction('tick', [state, validatedDecisions, scenario]);
      if (!tickResult.success) {
        hardViolations.push({
          round: r,
          type: 'missing-field',
          details: `tick() failed: ${tickResult.error}`,
        });
        break;
      }

      state = tickResult.result as Record<string, unknown>;

      // Hard invariant checks (parent-side)
      const hardResults = checkHardInvariants(state, r, scenario.agentCount);
      if (hardResults.length > 0) {
        hardViolations.push(...hardResults);
        break; // Hard invariant failure aborts
      }

      // Soft invariant checks (economy-side)
      const softResult = await dispatcher.callEconomyFunction('checkInvariants', [state, scenario]);
      if (!softResult.success) {
        hardViolations.push({
          round: r,
          type: 'missing-field',
          details: `checkInvariants() failed: ${softResult.error}`,
        });
        break;
      }
      if (!Array.isArray(softResult.result) || !softResult.result.every(v => typeof v === 'string')) {
        hardViolations.push({
          round: r,
          type: 'missing-field',
          details: 'checkInvariants() must return string[]',
        });
        break;
      }
      for (const v of softResult.result) {
        softViolations.push(`[Round ${r}] ${v}`);
      }

      // Extract metrics
      const metricsResult = await dispatcher.callEconomyFunction('extractMetrics', [state, scenario]);
      if (!metricsResult.success) {
        hardViolations.push({
          round: r,
          type: 'missing-field',
          details: `extractMetrics() failed: ${metricsResult.error}`,
        });
        break;
      }
      if (!isFiniteNumberRecord(metricsResult.result)) {
        hardViolations.push({
          round: r,
          type: 'nan-detected',
          details: 'extractMetrics() must return a plain object with finite numeric values',
        });
        break;
      }
      metricsPerRound.push(metricsResult.result);

      // Check collapse
      const collapseResult = await dispatcher.callEconomyFunction('isCollapsed', [state, scenario]);
      if (!collapseResult.success) {
        hardViolations.push({
          round: r,
          type: 'missing-field',
          details: `isCollapsed() failed: ${collapseResult.error}`,
        });
        break;
      }
      if (typeof collapseResult.result !== 'boolean') {
        hardViolations.push({
          round: r,
          type: 'missing-field',
          details: 'isCollapsed() must return a boolean',
        });
        break;
      }
      if (collapseResult.result === true) {
        collapsed = true;
        collapseRound = r;
      }

      opts.onRound?.(r, state, metricsPerRound[metricsPerRound.length - 1] ?? {});
    }

    return {
      rounds: metricsPerRound.length,
      finalState: state,
      metricsPerRound,
      softViolations,
      hardViolations,
      collapsed,
      collapseRound,
      invalidDecisions,
    };
  } finally {
    dispatcher.kill();
  }
}

function makeNoOpDecision(): null {
  return null;
}
