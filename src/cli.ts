// Agent 006: CLI — Entry point, arg parsing + validation, orchestration

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ARCHETYPES } from './archetypes.js';
import { FIXTURE_STRATEGIES } from './fixtures.js';
import { generateStrategies } from './generator.js';
import { runSimulation } from './runner.js';
import { computeAllMetrics } from './metrics.js';
import { generateReport, formatMetricsOnly } from './reporter.js';
import type { GameConfig, Strategy } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// --- Arg Parsing ---

interface CLIFlags {
  rounds: number;
  pool: number;
  regen: number;
  maxExtract: number;
  verbose: boolean;
  fixtures: boolean;
}

const MAX_POOL_SIZE = 100_000;

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

  return {
    rounds,
    pool: roundedPool,
    regen,
    maxExtract,
    verbose: values.verbose ?? false,
    fixtures: values.fixtures ?? false,
  };
}

// --- Display Helpers ---

function printBanner(config: GameConfig, fixturesMode: boolean): void {
  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log('  Agent 006: Incentive Wargame — Tragedy of the Commons');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Pool: ${config.poolSize}  |  Regen: ${(config.regenerationRate * 100).toFixed(0)}%  |  Max Extract: ${(config.maxExtractionRate * 100).toFixed(0)}%`);
  console.log(`  Rounds: ${config.rounds}  |  Agents: ${config.agentCount}  |  Mode: ${fixturesMode ? 'FIXTURES (deterministic)' : 'CLAUDE (AI-generated)'}`);
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

  printBanner(config, flags.fixtures);

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

  // --- Simulate ---
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
