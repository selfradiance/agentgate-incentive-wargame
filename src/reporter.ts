// Agent 006: Reporter
// Claude API: simulation log + metrics → structured findings report.
// Fallback to metrics-only on API failure.

import type { SimulationLog, AllMetrics, Strategy } from './types.js';
import { getAnthropicClient } from './anthropic-client.js';

const MODEL = 'claude-sonnet-4-20250514';

function buildReporterInput(log: SimulationLog, metrics: AllMetrics): string {
  const { config } = log;
  const roundsPlayed = log.rounds.length;

  // Substitution notices
  const substitutions = log.strategies.filter(s => s.isFallback);
  const substitutionNotice = substitutions.length > 0
    ? `\n\nSUBSTITUTION NOTICE: The following archetypes were replaced with cooperative fallback strategies due to generation/validation failure: ${substitutions.map(s => s.archetypeName).join(', ')}. This changes the scenario — results may not reflect the intended adversarial dynamics.\n`
    : '';

  // Round data: full for ≤50, summarized for 51-200
  let roundData: string;
  if (roundsPlayed <= 50) {
    roundData = log.rounds.map(r => {
      const extractions = r.actual.map((a, i) => `${log.archetypes[i].name}: ${a}`).join(', ');
      return `Round ${r.round}: pool ${r.poolBefore} → ${r.poolAfter} | extractions: ${extractions}`;
    }).join('\n');
  } else {
    const first5 = log.rounds.slice(0, 5);
    const last5 = log.rounds.slice(-5);
    const collapseRound = log.finalState.collapseRound
      ? log.rounds.find(r => r.round === log.finalState.collapseRound)
      : null;

    // Find tipping point round
    const tippingRound = metrics.collapseVelocity.tippingPointRound
      ? log.rounds.find(r => r.round === metrics.collapseVelocity.tippingPointRound)
      : null;

    const formatRound = (r: typeof log.rounds[0]) => {
      const extractions = r.actual.map((a, i) => `${log.archetypes[i].name}: ${a}`).join(', ');
      return `Round ${r.round}: pool ${r.poolBefore} → ${r.poolAfter} | extractions: ${extractions}`;
    };

    const parts = [
      'FIRST 5 ROUNDS:',
      ...first5.map(formatRound),
      '',
      `SUMMARIZED: Rounds 6-${roundsPlayed - 5} omitted. Per-round aggregates:`,
      ...log.rounds.slice(5, -5).map(r => {
        const totalExtraction = r.actual.reduce((s, a) => s + a, 0);
        return `  Round ${r.round}: pool ${r.poolBefore} → ${r.poolAfter}, total extraction: ${totalExtraction}`;
      }),
      '',
      'LAST 5 ROUNDS:',
      ...last5.map(formatRound),
    ];

    if (tippingRound && !first5.includes(tippingRound) && !last5.includes(tippingRound)) {
      parts.push('', 'TIPPING POINT ROUND:', formatRound(tippingRound));
    }
    if (collapseRound && !first5.includes(collapseRound) && !last5.includes(collapseRound)) {
      parts.push('', 'COLLAPSE ROUND:', formatRound(collapseRound));
    }

    parts.push('', 'NOTE: Only the rounds listed above are included. Do not invent or hallucinate data for rounds not shown.');

    roundData = parts.join('\n');
  }

  return `You are analyzing the results of an economic simulation: Tragedy of the Commons.

## Configuration
- Pool size: ${config.poolSize}
- Regeneration rate: ${config.regenerationRate}
- Max extraction rate: ${config.maxExtractionRate}
- Rounds configured: ${config.rounds}
- Rounds played: ${roundsPlayed}
- Agents: ${config.agentCount}
${substitutionNotice}
## Archetypes
${log.archetypes.map(a => `${a.index}. **${a.name}**: ${a.description}`).join('\n')}

## Simulation Data
${roundData}

## Metrics
1. **Gini Coefficient:** ${metrics.gini.gini}
2. **Pool Survival:** ${metrics.poolSurvival.survived ? 'SURVIVED all rounds' : `COLLAPSED at round ${metrics.poolSurvival.collapseRound}`}
3. **Per-Agent Wealth (ranked):**
${metrics.agentWealth.map(a => `   - ${a.archetypeName}: ${a.totalWealth}`).join('\n')}
4. **Over-Extraction Rate:** ${(metrics.overExtractionRate.overExtractionRate * 100).toFixed(1)}% (${metrics.overExtractionRate.overExtractionCount}/${metrics.overExtractionRate.totalAgentRounds} agent-rounds)
5. **System Efficiency:** ${metrics.systemEfficiency.efficiency} (total extracted: ${metrics.systemEfficiency.totalActualExtraction}, total MSY: ${metrics.systemEfficiency.totalMSY})
6. **Resource Health:** min ${(metrics.resourceHealth.minPoolFraction * 100).toFixed(1)}%, avg ${(metrics.resourceHealth.avgPoolFraction * 100).toFixed(1)}%, final ${(metrics.resourceHealth.finalPoolFraction * 100).toFixed(1)}%
7. **Collapse Velocity:** ${metrics.collapseVelocity.tippingPointRound !== null ? `tipping point at round ${metrics.collapseVelocity.tippingPointRound}` : 'no tipping point'}${metrics.collapseVelocity.roundsFromTipToCollapse !== null ? `, ${metrics.collapseVelocity.roundsFromTipToCollapse} rounds to collapse` : ''}
8. **First Over-Extraction:** ${metrics.firstOverExtraction ? `Round ${metrics.firstOverExtraction.round}, ${metrics.firstOverExtraction.archetypeName} extracted ${metrics.firstOverExtraction.amount} (sustainable share was ${metrics.firstOverExtraction.sustainableShare})` : 'None — all agents stayed within sustainable share'}

## Instructions
Generate a structured report with these exact sections:

1. **Executive Summary** — 2-3 sentences: did the commons survive? Which strategy dominated?
2. **Strategy Analysis** — one paragraph per archetype: how did each perform? Why?
3. **Substitution Notice** — if any archetypes were replaced with cooperative fallbacks, state which ones and note this changes the scenario. If none were substituted, write "No substitutions."
4. **Metrics Table** — all 8 metrics formatted for terminal readability
5. **System Assessment** — one paragraph: what do the results say about this incentive structure?
6. **Key Moments** — 3-5 inflection points: when did cooperation break down? When did the pool start declining?

Important:
- Be empirical, not prescriptive. Report what happened in this specific run.
- Do not invent or hallucinate data for rounds not included in the log.
- The over-extraction rate may spike artificially near collapse because MSY approaches zero — note this if it appears.
- "First Over-Extraction" measures an event, not morality. Use neutral language.`;
}

export interface ReportResult {
  report: string | null;
  metricsOnly: boolean;
  error?: string;
}

export async function generateReport(
  log: SimulationLog,
  metrics: AllMetrics,
): Promise<ReportResult> {
  try {
    const client = getAnthropicClient();
    const prompt = buildReporterInput(log, metrics);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const report = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    return { report, metricsOnly: false };
  } catch (err) {
    return {
      report: null,
      metricsOnly: true,
      error: `Report generation failed — ${(err as Error).message}`,
    };
  }
}

export function formatMetricsOnly(metrics: AllMetrics): string {
  const lines = [
    '══════════════════════════════════════════',
    '  METRICS (AI analysis unavailable)',
    '══════════════════════════════════════════',
    '',
    `  Gini Coefficient:     ${metrics.gini.gini}`,
    `  Pool Survival:        ${metrics.poolSurvival.survived ? 'SURVIVED' : `COLLAPSED (round ${metrics.poolSurvival.collapseRound})`}`,
    `  Over-Extraction Rate: ${(metrics.overExtractionRate.overExtractionRate * 100).toFixed(1)}%`,
    `  System Efficiency:    ${metrics.systemEfficiency.efficiency}`,
    `  Resource Health:      min ${(metrics.resourceHealth.minPoolFraction * 100).toFixed(1)}% / avg ${(metrics.resourceHealth.avgPoolFraction * 100).toFixed(1)}% / final ${(metrics.resourceHealth.finalPoolFraction * 100).toFixed(1)}%`,
    `  Collapse Velocity:    ${metrics.collapseVelocity.tippingPointRound !== null ? `tip round ${metrics.collapseVelocity.tippingPointRound}` : 'no tipping point'}${metrics.collapseVelocity.roundsFromTipToCollapse !== null ? `, ${metrics.collapseVelocity.roundsFromTipToCollapse} rounds to collapse` : ''}`,
    `  First Over-Extraction:${metrics.firstOverExtraction ? ` Round ${metrics.firstOverExtraction.round} (${metrics.firstOverExtraction.archetypeName})` : ' None'}`,
    '',
    '  Per-Agent Wealth:',
    ...metrics.agentWealth.map(a => `    ${a.archetypeName.padEnd(14)} ${a.totalWealth}`),
    '',
    '══════════════════════════════════════════',
  ];
  return lines.join('\n');
}
