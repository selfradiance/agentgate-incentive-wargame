// Agent 006: CLI — Entry point, arg parsing + validation, orchestration
// v0.2.0: Adds --runs flag for campaign mode with strategy adaptation.
// v0.3.0: Adds --spec, --agents, --yes, --dry-run for user-defined scenarios.

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { ARCHETYPES } from './archetypes.js';
import { FIXTURE_STRATEGIES } from './fixtures.js';
import { generateStrategies } from './generator.js';
import { runSimulation, runCampaign } from './runner.js';
import { computeAllMetrics } from './metrics.js';
import { generateReport, formatMetricsOnly, generateCampaignReport, formatCampaignMetricsOnly } from './reporter.js';
import { adaptAllStrategies } from './adapter.js';
import { extractScenario } from './extractor.js';
import { generateEconomyModule } from './economy-gen.js';
import { generateArchetypes } from './archetype-gen.js';
import { generateScenarioStrategies } from './generator.js';
import { runScenarioSimulation } from './runner.js';
import { generateScenarioReport, formatScenarioMetricsOnly } from './reporter.js';
import type { GameConfig, Strategy, CampaignResult, NormalizedScenario } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { readFileSync } from 'node:fs';

// --- Arg Parsing ---

interface CLIFlags {
  rounds: number;
  pool: number;
  regen: number;
  maxExtract: number;
  verbose: boolean;
  fixtures: boolean;
  runs: number;
  spec: string | null;
  agents: number | null;
  yes: boolean;
  dryRun: boolean;
}

const MAX_POOL_SIZE = 100_000;
const MAX_RUNS = 10;
const MAX_SPEC_BYTES = 50 * 1024;

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
      spec:         { type: 'string' },
      agents:       { type: 'string' },
      yes:          { type: 'boolean', default: false },
      'dry-run':    { type: 'boolean', default: false },
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

  const fixtures = values.fixtures ?? false;

  // When --fixtures is specified without explicit --runs, default to 1 run
  const runsRaw = Number(values.runs);
  const runsExplicitlySet = args.some(arg => arg === '--runs' || arg.startsWith('--runs='));
  const runs = (fixtures && !runsExplicitlySet) ? 1 : runsRaw;

  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
    throw new Error(`Invalid --runs value: ${values.runs}. Must be an integer between 1 and ${MAX_RUNS}.`);
  }

  // Mutual exclusion: --fixtures and --runs > 1
  if (fixtures && runs > 1) {
    throw new Error('--fixtures and --runs are mutually exclusive. Fixture strategies are deterministic and do not adapt.');
  }

  // --spec flag
  const spec = values.spec ?? null;
  if (spec !== null && spec.trim().length === 0) {
    throw new Error('--spec must be a non-empty file path.');
  }

  // --agents flag (only valid with --spec)
  let agents: number | null = null;
  if (values.agents !== undefined) {
    if (!spec) {
      throw new Error('--agents is only valid with --spec');
    }
    agents = Number(values.agents);
    if (!Number.isInteger(agents) || agents < 2 || agents > 20) {
      throw new Error(`Invalid --agents value: ${values.agents}. Must be an integer between 2 and 20.`);
    }
  }

  // --spec and --fixtures are mutually exclusive
  if (spec && fixtures) {
    throw new Error('--spec and --fixtures are mutually exclusive.');
  }

  return {
    rounds,
    pool: roundedPool,
    regen,
    maxExtract,
    verbose: values.verbose ?? false,
    fixtures,
    runs,
    spec,
    agents,
    yes: values.yes ?? false,
    dryRun: values['dry-run'] ?? false,
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

function printCampaignRunSummary(
  runNumber: number,
  totalRuns: number,
  survived: boolean,
  completed: boolean,
  collapseRound: number | null,
  completedRounds: number,
  totalConfiguredRounds: number,
): void {
  const status = !completed
    ? `INCOMPLETE (${completedRounds}/${totalConfiguredRounds} rounds)`
    : survived
      ? 'SURVIVED'
      : `COLLAPSED (round ${collapseRound})`;
  console.log(`  ── Run ${runNumber}/${totalRuns}: ${status} ──`);
}

// --- Scenario Confirmation Gate ---

export function formatScenarioSummary(scenario: NormalizedScenario): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('══════════════════════════════════════════════════════════');
  lines.push('  Extracted Scenario Summary');
  lines.push('══════════════════════════════════════════════════════════');
  lines.push(`  Name: ${scenario.name}`);
  lines.push(`  Description: ${scenario.description}`);
  lines.push(`  Agents: ${scenario.agentCount}`);
  lines.push(`  Scenario Class: ${scenario.scenarioClass}`);
  lines.push('');

  if (scenario.roles.length > 0) {
    lines.push('  Roles:');
    for (const role of scenario.roles) {
      lines.push(`    • ${role.name} — ${role.description}`);
    }
    lines.push('');
  }

  if (scenario.resources.length > 0) {
    lines.push('  Resources:');
    for (const res of scenario.resources) {
      const bounds = [
        res.min !== undefined ? `min: ${res.min}` : '',
        res.max !== undefined ? `max: ${res.max}` : '',
      ].filter(Boolean).join(', ');
      lines.push(`    • ${res.name} (initial: ${res.initialValue}${bounds ? ', ' + bounds : ''}) — ${res.description}`);
    }
    lines.push('');
  }

  lines.push('  Actions:');
  for (const action of scenario.actions) {
    const roleNote = action.allowedRoles.length > 0
      ? ` [roles: ${action.allowedRoles.join(', ')}]`
      : '';
    lines.push(`    • ${action.name}${roleNote} — ${action.description}`);
    for (const param of action.params) {
      const range = param.type === 'number' && (param.min !== undefined || param.max !== undefined)
        ? ` [${param.min ?? '?'}..${param.max ?? '?'}]`
        : '';
      lines.push(`        ${param.name}: ${param.type}${range} — ${param.description}`);
    }
  }
  lines.push('');

  lines.push('  Observations:');
  for (const obs of scenario.observationModel) {
    lines.push(`    • ${obs.name}: ${obs.type} (${obs.visibility}) — ${obs.description}`);
  }
  lines.push('');

  if (scenario.rules.length > 0) {
    lines.push('  Rules:');
    for (const rule of scenario.rules) {
      lines.push(`    [${rule.type.toUpperCase()}] ${rule.description}`);
    }
    lines.push('');
  }

  lines.push(`  Collapse: ${scenario.collapseCondition}`);
  lines.push(`  Success: ${scenario.successCondition}`);

  if (scenario.ambiguities.length > 0) {
    lines.push('');
    lines.push('  ⚠ Ambiguities:');
    for (const amb of scenario.ambiguities) {
      const severityMarker = amb.severity === 'high' ? '🔴' : amb.severity === 'medium' ? '🟡' : '🟢';
      lines.push(`    ${severityMarker} [${amb.severity.toUpperCase()}] ${amb.field}: ${amb.description}`);
      lines.push(`       Resolution: ${amb.resolution}`);
    }
  }

  lines.push('══════════════════════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
}

export async function confirmScenario(
  scenario: NormalizedScenario,
  opts: { autoYes?: boolean; input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream } = {},
): Promise<boolean> {
  const summary = formatScenarioSummary(scenario);
  const output = opts.output ?? process.stdout;
  output.write(summary);

  if (opts.autoYes) {
    output.write('  Auto-confirmed (--yes)\n');
    return true;
  }

  const rl = createInterface({
    input: opts.input ?? process.stdin,
    output,
  });

  return new Promise<boolean>((resolve) => {
    rl.question('  Proceed with this scenario? (y/n): ', (answer) => {
      rl.close();
      const yes = answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
      resolve(yes);
    });
  });
}

// --- Scenario Mode ---

async function runScenarioMode(flags: CLIFlags): Promise<void> {
  const specPath = flags.spec!;

  // 1. Read spec file
  let specText: string;
  try {
    specText = readFileSync(specPath, 'utf-8');
  } catch (err) {
    console.error(`Error: Cannot read spec file: ${specPath} — ${(err as Error).message}`);
    process.exit(2);
  }

  if (!specText.trim()) {
    console.error('Error: Spec file is empty.');
    process.exit(2);
  }
  if (Buffer.byteLength(specText, 'utf-8') > MAX_SPEC_BYTES) {
    console.error(`Error: Spec file exceeds ${MAX_SPEC_BYTES} bytes.`);
    process.exit(2);
  }

  // 2. Extract scenario via Claude API
  console.log('');
  console.log('  Extracting scenario from spec...');
  let scenario: NormalizedScenario;
  try {
    scenario = await extractScenario(specText);
  } catch (err) {
    console.error(`Error: Scenario extraction failed — ${(err as Error).message}`);
    process.exit(2);
    return; // unreachable, helps TS
  }

  // 3. Override agentCount if --agents provided
  if (flags.agents !== null) {
    scenario = { ...scenario, agentCount: flags.agents };
  }

  // 4. Verbose: show extracted scenario JSON
  if (flags.verbose) {
    console.log('');
    console.log('── Extracted Scenario JSON ──────────────────────────────');
    console.log(JSON.stringify(scenario, null, 2));
    console.log('─────────────────────────────────────────────────────────');
  }

  // 5. Confirmation gate
  const confirmed = await confirmScenario(scenario, { autoYes: flags.yes });
  if (!confirmed) {
    console.log('  Scenario rejected. Exiting.');
    process.exit(0);
  }

  // 6. Generate economy module
  console.log('  Generating economy module...');
  let economyCode: string;
  try {
    economyCode = await generateEconomyModule(scenario);
  } catch (err) {
    console.error(`Error: Economy generation failed — ${(err as Error).message}`);
    process.exit(2);
    return;
  }
  console.log('  Economy module generated.');

  if (flags.verbose) {
    console.log('');
    console.log('── Generated Economy Code ──────────────────────────────');
    console.log(economyCode);
    console.log('─────────────────────────────────────────────────────────');
  }

  // 7. Generate archetypes
  console.log('  Generating archetypes...');
  let archetypes: import('./types.js').Archetype[];
  try {
    archetypes = await generateArchetypes(scenario);
  } catch (err) {
    console.error(`Error: Archetype generation failed — ${(err as Error).message}`);
    process.exit(2);
    return;
  }
  console.log(`  ${archetypes.length} archetypes generated.`);

  // 8. Dry run: print results and stop
  if (flags.dryRun) {
    console.log('');
    console.log('  ── DRY RUN: Stopping before strategy generation ──');
    console.log('');
    console.log('  Archetypes:');
    for (const a of archetypes) {
      console.log(`    ${a.index}. ${a.name} — ${a.description}`);
    }
    console.log('');
    process.exit(0);
  }

  // 9. Generate strategies
  console.log('  Generating strategies...');
  let strategies: Strategy[];
  let substitutions: string[] = [];
  try {
    const genResult = await generateScenarioStrategies(archetypes, scenario);
    strategies = genResult.strategies;
    substitutions = genResult.substitutions;

    if (genResult.errors.length > 0) {
      for (const err of genResult.errors) {
        console.error(`  [gen] ${err}`);
      }
    }

    console.log('  Strategies generated.');
  } catch (err) {
    console.error(`Error: Strategy generation failed — ${(err as Error).message}`);
    process.exit(2);
    return;
  }

  if (flags.verbose) {
    console.log('');
    console.log('── Generated Strategy Code ──────────────────────────────');
    for (const s of strategies) {
      console.log(`\n[${s.archetypeName}]${s.isFallback ? ' (FALLBACK)' : ''}`);
      console.log(s.code);
    }
    console.log('─────────────────────────────────────────────────────────');
  }

  if (substitutions.length > 0) {
    printSubstitutionNotice(substitutions);
  }

  // 10. Run simulation
  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${scenario.name}`);
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Agents: ${scenario.agentCount}  |  Rounds: ${flags.rounds}  |  Mode: SCENARIO`);
  console.log('══════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Running simulation...');
  console.log('');

  const result = await runScenarioSimulation({
    scenario,
    economyCode,
    archetypes,
    strategies,
    rounds: flags.rounds,
    onRound: (round, _state, metrics) => {
      // Simple progress indicator
      const pct = Math.round((round / flags.rounds) * 100);
      process.stdout.write(`\r  Round ${String(round).padStart(3)}/${flags.rounds}  [${pct}%]`);
      if (round === flags.rounds) console.log('');
    },
  });

  // 11. Print result summary
  console.log('');
  console.log('┌──────────────────────────────────────────────────────┐');
  if (result.collapsed) {
    console.log(`│  RESULT: COLLAPSED (round ${result.collapseRound}) ✗`.padEnd(55) + '│');
  } else {
    console.log(`│  RESULT: SURVIVED ${result.rounds} rounds ✓`.padEnd(55) + '│');
  }
  if (result.hardViolations.length > 0) {
    console.log(`│  Hard Violations: ${result.hardViolations.length}`.padEnd(55) + '│');
  }
  if (result.softViolations.length > 0) {
    console.log(`│  Soft Violations: ${result.softViolations.length}`.padEnd(55) + '│');
  }
  if (result.invalidDecisions.length > 0) {
    console.log(`│  Invalid Decisions: ${result.invalidDecisions.length}`.padEnd(55) + '│');
  }
  console.log('└──────────────────────────────────────────────────────┘');

  // 12. Generate report
  console.log('');
  console.log('  Generating analysis report...');
  try {
    const reportResult = await generateScenarioReport(scenario, archetypes, result);

    if (reportResult.metricsOnly) {
      console.log(`  ${reportResult.error}`);
      console.log('');
      console.log(formatScenarioMetricsOnly(scenario, result));
    } else {
      console.log('');
      console.log(reportResult.report);
    }
  } catch (err) {
    console.error(`  Report generation failed — ${(err as Error).message}`);
    console.log('');
    console.log(formatScenarioMetricsOnly(scenario, result));
  }

  console.log('');

  // 13. Exit code: 0 = survived, 1 = collapsed or hard violations
  if (result.collapsed || result.hardViolations.length > 0) {
    process.exit(1);
  }
  process.exit(0);
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

  // --- Scenario Mode (--spec) ---
  if (flags.spec) {
    await runScenarioMode(flags);
    return;
  }

  // --- Commons Mode (default) ---
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
        printCampaignRunSummary(
          runNumber,
          flags.runs,
          metrics.poolSurvival.survived,
          metrics.poolSurvival.completed,
          metrics.poolSurvival.collapseRound,
          log.rounds.length,
          config.rounds,
        );
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
    const anyIncomplete = campaignResult.runs.some(r => !r.metrics.poolSurvival.completed);
    console.log('');
    console.log('┌──────────────────────────────────────────────────────┐');
    console.log(`│  CAMPAIGN: ${campaignResult.runs.length} run(s) completed`.padEnd(55) + '│');
    console.log(`│  Resilience Trend: ${campaignResult.resilienceTrend.trend}`.padEnd(55) + '│');
    if (anyIncomplete) {
      console.log('│  Run Status: INCOMPLETE'.padEnd(55) + '│');
    }
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

    // Exit codes: 0 = all survived, 1 = any collapsed, incomplete, or aborted
    if (anyCollapsed || anyIncomplete || campaignResult.aborted) {
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
