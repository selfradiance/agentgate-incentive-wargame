// Agent 006: CLI — Entry point, arg parsing + validation, orchestration
// v0.2.0: Adds --runs flag for campaign mode with strategy adaptation.

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ARCHETYPES } from './archetypes.js';
import { FIXTURE_STRATEGIES } from './fixtures.js';
import { generateStrategies } from './generator.js';
import { runSimulation, runCampaign } from './runner.js';
import { computeAllMetrics } from './metrics.js';
import { generateReport, formatMetricsOnly, generateCampaignReport, formatCampaignMetricsOnly } from './reporter.js';
import { adaptAllStrategies } from './adapter.js';
import type { GameConfig, Strategy, CampaignResult } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// --- Arg Parsing ---

interface CLIFlags {
  rounds: number;
  pool: number;
  regen: number;
  maxExtract: number;
  verbose: boolean;
  fixtures: boolean;
  runs: number;
}

const MAX_POOL_SIZE = 100_000;
const MAX_RUNS = 10;

export function parseAndValidateArgs(args: string[] = process.argv.slice(2)): CLIFlags {
  const { values } = parseArgs({
    args,
    options: {
      rounds:       { type: 'string', default: String(DEFAULT_CONFIG.rounds) },
      pool:         { type: 'string', default: String(DEFAULT_CONFIG.poolSize) },
      regen:        { type: 'string', default: String(DEFAULT_CONFIG.regenerationRate) },
      'max-extract':{ type: 'string', default: String(DEFAULT_CONFIG.maxExtractionRate) },
      verbose:      { type: 'boolean', default: false },
      fixtures:     { type: 'boolean', default: false },
      runs:         { type: 'string', default: '3' },
    },
    strict: true,
  });

  const rounds = Number(values.rounds);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 200) {
    throw new Error(`Invalid --rounds value: ${values.rounds}. Must be an integer between 1 and 200.`);
  }

  const pool = Number(values.pool);
  const roundedPool = Math.round(pool * 100) / 100;
  if (
    !Number.isFinite(pool)
    || pool < 1
    || pool > MAX_POOL_SIZE
    || Math.abs(pool - roundedPool) > 1e-9
  ) {
    throw new Error(
      `Invalid --pool value: ${values.pool}. Must be between 1.00 and ${MAX_POOL_SIZE.toFixed(2)} with at most 2 decimal places.`
    );
  }

  const regen = Number(values.regen);
  if (!Number.isFinite(regen) || regen < 0 || regen > 1) {
    throw new Error(`Invalid --regen value: ${values.regen}. Must be between 0.00 and 1.00.`);
  }

  const maxExtract = Number(values['max-extract']);
  if (!Number.isFinite(maxExtract) || maxExtract < 0.01 || maxExtract > 1) {
    throw new Error(`Invalid --max-extract value: ${values['max-extract']}. Must be between 0.01 and 1.00.`);
  }

  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
    throw new Error(`Invalid --runs value: ${values.runs}. Must be an integer between 1 and ${MAX_RUNS}.`);
  }

  const fixtures = values.fixtures ?? false;

  // Mutual exclusion: --fixtures and --runs > 1
  if (fixtures && runs > 1) {
    throw new Error('--fixtures and --runs are mutually exclusive. Fixture strategies are deterministic and do not adapt.');
  }

  return {
    rounds,
    pool: roundedPool,
    regen,
    maxExtract,
    verbose: values.verbose ?? false,
    fixtures,
    runs,
  };
}

// --- Display Helpers ---

function printBanner(config: GameConfig, fixturesMode: boolean, totalRuns: number): void {
  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log('  Agent 006: Incentive Wargame — Tragedy of the Commons');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Pool: ${config.poolSize}  |  Regen: ${(config.regenerationRate * 100).toFixed(0)}%  |  Max Extract: ${(config.maxExtractionRate * 100).toFixed(0)}%`);
  const mode = fixturesMode ? 'FIXTURES (deterministic)' : totalRuns > 1 ? `CAMPAIGN (${totalRuns} runs)` : 'CLAUDE (AI-generated)';
  console.log(`  Rounds: ${config.rounds}  |  Agents: ${config.agentCount}  |  Mode: ${mode}`);
  console.log('══════════════════════════════════════════════════════════');
  console.log('');
}

function printSubstitutionNotice(substitutions: string[]): void {
  if (substitutions.length === 0) return;
  console.log('');
  console.log('┌─────────────────────────────────────────────────────┐');
  console.log('│  NOTE: The following archetypes were replaced with  │');
  console.log('│  cooperative fallbacks. Results may not reflect the  │');
  console.log('│  intended scenario.                                 │');
  for (const name of substitutions) {
    console.log(`│    → ${name.padEnd(45)}│`);
  }
  console.log('└─────────────────────────────────────────────────────┘');
  console.log('');
}

function printRoundProgress(round: number, totalRounds: number, poolAfter: number, collapsed: boolean, poolSize: number): void {
  const bar = Math.max(0, Math.min(30, Math.round((poolAfter / poolSize) * 30)));
  const barStr = '█'.repeat(bar) + '░'.repeat(30 - bar);
  const status = collapsed ? ' !! COLLAPSED' : '';
  process.stdout.write(`\r  Round ${String(round).padStart(3)}/${totalRounds}  [${barStr}]  pool: ${String(poolAfter).padStart(7)}${status}`);
  if (collapsed || round === totalRounds) {
    console.log('');
  }
}

function printSummaryBox(survived: boolean, collapseRound: number | null, substitutions: string[]): void {
  console.log('');
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log(`│  RESULT: ${survived ? 'COMMONS SURVIVED ✓' : `COMMONS COLLAPSED (round ${collapseRound}) ✗`}`.padEnd(55) + '│');
  if (substitutions.length > 0) {
    console.log('│                                                      │');
    console.log('│  NOTE: Fallback substitutions were active:           │');
    for (const name of substitutions) {
      console.log(`│    → ${name.padEnd(48)}│`);
    }
  }
  console.log('└──────────────────────────────────────────────────────┘');
}

function printIncompleteSummaryBox(completedRounds: number, totalRounds: number, substitutions: string[]): void {
  console.log('');
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log(`│  RESULT: ${'SIMULATION INCOMPLETE ✗'.padEnd(55)}│`);
  console.log(`│  NOTE: ${`${completedRounds}/${totalRounds} rounds completed before termination.`.padEnd(46)}│`);
  if (substitutions.length > 0) {
    console.log('│                                                      │');
    console.log('│  NOTE: Fallback substitutions were active:           │');
    for (const name of substitutions) {
      console.log(`│    → ${name.padEnd(48)}│`);
    }
  }
  console.log('└──────────────────────────────────────────────────────┘');
}

function printCampaignRunSummary(runNumber: number, totalRuns: number, survived: boolean, collapseRound: number | null): void {
  const status = survived ? 'SURVIVED' : `COLLAPSED (round ${collapseRound})`;
  console.log(`  ── Run ${runNumber}/${totalRuns}: ${status} ──`);
}

// --- Main ---

async function main(): Promise<void> {
  let flags: CLIFlags;
  try {
    flags = parseAndValidateArgs();
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(2);
  }

  const config: GameConfig = {
    poolSize: flags.pool,
    regenerationRate: flags.regen,
    maxExtractionRate: flags.maxExtract,
    rounds: flags.rounds,
    agentCount: ARCHETYPES.length,
  };

  printBanner(config, flags.fixtures, flags.runs);

  // --- Generate or Load Strategies ---
  let strategies: Strategy[];
  let substitutions: string[] = [];

  if (flags.fixtures) {
    console.log('  Loading fixture strategies (deterministic mode)...');
    strategies = FIXTURE_STRATEGIES.map((fn, i) => ({
      archetypeIndex: i,
      archetypeName: ARCHETYPES[i].name,
      code: fn.toString(),
      isFallback: false,
    }));
  } else {
    console.log('  Generating strategies via Claude API...');
    try {
      const genResult = await generateStrategies(ARCHETYPES, config);
      strategies = genResult.strategies;
      substitutions = genResult.substitutions;

      if (genResult.errors.length > 0) {
        for (const err of genResult.errors) {
          console.error(`  [gen] ${err}`);
        }
      }

      console.log('  Strategies generated successfully.');
    } catch (err) {
      console.error(`\n  ${(err as Error).message}`);
      process.exit(2);
    }
  }

  if (flags.verbose) {
    console.log('');
    console.log('── Generated Strategy Code ──────────────────────────────');
    for (const s of strategies) {
      console.log(`\n[${s.archetypeName}]${s.isFallback ? ' (FALLBACK)' : ''}`);
      console.log(s.code);
    }
    console.log('─────────────────────────────────────────────────────────');
    console.log('');
  }

  printSubstitutionNotice(substitutions);

  // --- Campaign Mode (multiple runs with adaptation) ---
  if (flags.runs > 1) {
    console.log(`  Running campaign (${flags.runs} runs)...`);
    console.log('');

    const campaignResult = await runCampaign({
      config,
      archetypes: ARCHETYPES,
      initialStrategies: strategies,
      totalRuns: flags.runs,
      adaptFn: adaptAllStrategies,
      onRunStart: (runNumber) => {
        console.log(`\n  ═══ Run ${runNumber}/${flags.runs} ═══`);
      },
      onRound: (_runNumber, result) => {
        printRoundProgress(result.round, config.rounds, result.poolAfter, result.collapsed, config.poolSize);
      },
      onRunEnd: (runNumber, log, metrics) => {
        const survived = metrics.poolSurvival.survived;
        printCampaignRunSummary(runNumber, flags.runs, survived, metrics.poolSurvival.collapseRound);
      },
      onAdaptStart: (runNumber) => {
        console.log(`\n  Adapting strategies for Run ${runNumber}...`);
      },
      onAdaptEnd: (_runNumber, result) => {
        const fallbacks = result.results.filter(r => r.usedFallback);
        if (fallbacks.length > 0) {
          console.log(`  Adaptation: ${fallbacks.length} agent(s) used fallback — ${fallbacks.map(r => r.archetypeName).join(', ')}`);
        } else {
          console.log('  Adaptation: All 7 agents adapted successfully.');
        }
      },
    });

    // --- Campaign Report ---
    console.log('');

    if (campaignResult.aborted) {
      console.log(`  CAMPAIGN ABORTED: ${campaignResult.abortReason}`);
    }

    // Print campaign summary box
    const anyCollapsed = campaignResult.runs.some(r => r.log.finalState.collapsed);
    console.log('');
    console.log('┌──────────────────────────────────────────────────────┐');
    console.log(`│  CAMPAIGN: ${campaignResult.runs.length} run(s) completed`.padEnd(55) + '│');
    console.log(`│  Resilience Trend: ${campaignResult.resilienceTrend.trend}`.padEnd(55) + '│');
    if (campaignResult.adaptationTheater.detected) {
      console.log('│  Adaptation Theater: DETECTED'.padEnd(55) + '│');
    }
    if (campaignResult.archetypeCollapse.detected) {
      console.log('│  Archetype Collapse: DETECTED'.padEnd(55) + '│');
    }
    console.log('└──────────────────────────────────────────────────────┘');

    console.log('');

    if (flags.fixtures && !process.env.ANTHROPIC_API_KEY) {
      console.log(formatCampaignMetricsOnly(campaignResult));
      console.log('');
      console.log('  Note: Report generation skipped (no API key in fixtures mode).');
    } else {
      console.log('  Generating campaign analysis report...');
      try {
        const reportResult = await generateCampaignReport(campaignResult);

        if (reportResult.metricsOnly) {
          console.log(`  ${reportResult.error}`);
          console.log('');
          console.log(formatCampaignMetricsOnly(campaignResult));
        } else {
          console.log('');
          console.log(reportResult.report);
        }
      } catch (err) {
        console.error(`  Campaign report generation failed — ${(err as Error).message}`);
        console.log('');
        console.log(formatCampaignMetricsOnly(campaignResult));
      }
    }

    console.log('');

    // Exit codes: 0 = all survived, 1 = any collapsed or aborted
    if (anyCollapsed || campaignResult.aborted) {
      process.exit(1);
    }
    process.exit(0);
  }

  // --- Single Run Mode (unchanged from v0.1.0) ---
  console.log('  Running simulation...');
  console.log('');

  const log = await runSimulation({
    config,
    archetypes: ARCHETYPES,
    strategies,
    onRound: (result) => {
      printRoundProgress(result.round, config.rounds, result.poolAfter, result.collapsed, config.poolSize);
    },
  });

  // --- Metrics ---
  const metrics = computeAllMetrics(log);

  const incomplete = !metrics.poolSurvival.completed;

  if (incomplete) {
    printIncompleteSummaryBox(log.rounds.length, config.rounds, substitutions);
  } else {
    printSummaryBox(metrics.poolSurvival.survived, metrics.poolSurvival.collapseRound, substitutions);
  }

  // --- Report ---
  console.log('');

  if (flags.fixtures && !process.env.ANTHROPIC_API_KEY) {
    // Fixtures mode without API key — metrics only
    console.log(formatMetricsOnly(metrics));
    console.log('');
    console.log('  Note: Report generation skipped (no API key in fixtures mode).');
  } else {
    console.log('  Generating analysis report...');
    try {
      const reportResult = await generateReport(log, metrics);

      if (reportResult.metricsOnly) {
        console.log(`  ${reportResult.error}`);
        console.log('');
        console.log(formatMetricsOnly(metrics));
      } else {
        console.log('');
        console.log(reportResult.report);
      }
    } catch (err) {
      console.error(`  Report generation failed — ${(err as Error).message}`);
      console.log('');
      console.log(formatMetricsOnly(metrics));
    }
  }

  console.log('');

  // --- Exit Code ---
  // 0 = survived, 1 = collapsed or incomplete, 2 = never ran
  if (log.finalState.collapsed || incomplete) {
    process.exit(1);
  }
  process.exit(0);
}

const isMainModule = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((err) => {
    console.error(`Fatal error: ${(err as Error).message}`);
    process.exit(2);
  });
}
