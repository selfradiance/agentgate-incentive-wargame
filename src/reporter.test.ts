import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateReport, formatMetricsOnly } from './reporter.js';
import type { SimulationLog, AllMetrics, GameConfig, Archetype } from './types.js';

const mockCreate = vi.fn();

vi.mock('./anthropic-client.js', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: mockCreate,
    },
  }),
}));

beforeEach(() => {
  mockCreate.mockReset();
});

const config: GameConfig = {
  poolSize: 1000, regenerationRate: 0.10, maxExtractionRate: 0.20, rounds: 50, agentCount: 3,
};

const archetypes: Archetype[] = [
  { index: 0, name: 'Greedy', description: 'Max extraction' },
  { index: 1, name: 'Cooperative', description: 'Sustainable share' },
  { index: 2, name: 'Stabilizer', description: 'Active stewardship' },
];

function makeLog(overrides: Partial<SimulationLog> = {}): SimulationLog {
  return {
    config,
    archetypes,
    strategies: archetypes.map(a => ({ archetypeIndex: a.index, archetypeName: a.name, code: '', isFallback: false })),
    rounds: [
      { round: 1, poolBefore: 1000, poolAfter: 900, requested: [200, 30, 30], actual: [200, 30, 30], agentWealth: [200, 30, 30], collapsed: false },
      { round: 2, poolBefore: 900, poolAfter: 800, requested: [180, 27, 27], actual: [180, 27, 27], agentWealth: [380, 57, 57], collapsed: false },
    ],
    finalState: {
      pool: 800, round: 2, agentWealth: [380, 57, 57],
      agentHistory: [[200, 180], [30, 27], [30, 27]], poolHistory: [1000, 900],
      collapsed: false, collapseRound: null,
    },
    ...overrides,
  };
}

function makeMetrics(): AllMetrics {
  return {
    gini: { gini: 0.55 },
    poolSurvival: { survived: true, collapseRound: null },
    agentWealth: [
      { archetypeName: 'Greedy', totalWealth: 380 },
      { archetypeName: 'Cooperative', totalWealth: 57 },
      { archetypeName: 'Stabilizer', totalWealth: 57 },
    ],
    overExtractionRate: { overExtractionRate: 0.3333, overExtractionCount: 2, totalAgentRounds: 6 },
    systemEfficiency: { efficiency: 1.5, totalActualExtraction: 494, totalMSY: 190 },
    resourceHealth: { minPoolFraction: 0.8, avgPoolFraction: 0.85, finalPoolFraction: 0.8 },
    collapseVelocity: { tippingPointRound: 1, roundsFromTipToCollapse: null },
    firstOverExtraction: { round: 1, agentIndex: 0, archetypeName: 'Greedy', amount: 200, sustainableShare: 33.33 },
  };
}

describe('generateReport', () => {
  it('returns Claude report on success', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '# Executive Summary\nThe commons survived.' }],
    } as never);

    const result = await generateReport(makeLog(), makeMetrics());

    expect(result.metricsOnly).toBe(false);
    expect(result.report).toContain('Executive Summary');
    expect(result.error).toBeUndefined();
  });

  it('falls back to metrics-only on API failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API down') as never);

    const result = await generateReport(makeLog(), makeMetrics());

    expect(result.metricsOnly).toBe(true);
    expect(result.report).toBeNull();
    expect(result.error).toContain('API down');
  });

  it('includes substitution notice when strategies were replaced', async () => {
    const log = makeLog({
      strategies: [
        { archetypeIndex: 0, archetypeName: 'Greedy', code: '', isFallback: true },
        { archetypeIndex: 1, archetypeName: 'Cooperative', code: '', isFallback: false },
        { archetypeIndex: 2, archetypeName: 'Stabilizer', code: '', isFallback: false },
      ],
    });

    let capturedPrompt = '';
    mockCreate.mockImplementationOnce(async (args: unknown) => {
      const a = args as { messages: { content: string }[] };
      capturedPrompt = a.messages[0].content;
      return { content: [{ type: 'text', text: 'Report with substitution.' }] };
    });

    await generateReport(log, makeMetrics());

    expect(capturedPrompt).toContain('SUBSTITUTION NOTICE');
    expect(capturedPrompt).toContain('Greedy');
  });
});

describe('formatMetricsOnly', () => {
  it('formats all 8 metrics for terminal display', () => {
    const output = formatMetricsOnly(makeMetrics());

    expect(output).toContain('Gini Coefficient');
    expect(output).toContain('0.55');
    expect(output).toContain('SURVIVED');
    expect(output).toContain('Over-Extraction Rate');
    expect(output).toContain('33.3%');
    expect(output).toContain('System Efficiency');
    expect(output).toContain('1.5');
    expect(output).toContain('Resource Health');
    expect(output).toContain('Collapse Velocity');
    expect(output).toContain('First Over-Extraction');
    expect(output).toContain('Greedy');
    expect(output).toContain('380');
  });

  it('shows COLLAPSED when pool did not survive', () => {
    const metrics = makeMetrics();
    metrics.poolSurvival = { survived: false, collapseRound: 15 };
    const output = formatMetricsOnly(metrics);
    expect(output).toContain('COLLAPSED');
    expect(output).toContain('round 15');
  });
});
