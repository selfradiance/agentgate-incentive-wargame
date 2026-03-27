import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateStrategies } from './generator.js';
import { ARCHETYPES } from './archetypes.js';
import { DEFAULT_CONFIG } from './types.js';

// Shared mock for the API client
const mockCreate = vi.fn();

vi.mock('./anthropic-client.js', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: mockCreate,
    },
  }),
}));

function mockApiResponse(code: string) {
  return {
    content: [{ type: 'text', text: code }],
  };
}

function validStrategyCode(name: string): string {
  return `function ${name.toLowerCase()}(state) {\n  return Math.min(state.sustainableShare, state.maxExtraction);\n}`;
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe('generateStrategies', () => {
  it('generates all 7 strategies successfully', async () => {
    for (const arch of ARCHETYPES) {
      mockCreate.mockResolvedValueOnce(
        mockApiResponse(validStrategyCode(arch.name)) as never
      );
    }

    const result = await generateStrategies(ARCHETYPES, DEFAULT_CONFIG);

    expect(result.strategies).toHaveLength(7);
    expect(result.substitutions).toHaveLength(0);
    expect(result.strategies.every(s => !s.isFallback)).toBe(true);
  });

  it('retries on first failure, succeeds on second attempt', async () => {
    // First archetype: first call fails, retry succeeds
    mockCreate.mockRejectedValueOnce(new Error('API timeout') as never);
    mockCreate.mockResolvedValueOnce(
      mockApiResponse(validStrategyCode(ARCHETYPES[0].name)) as never
    );

    // Rest succeed on first try
    for (let i = 1; i < ARCHETYPES.length; i++) {
      mockCreate.mockResolvedValueOnce(
        mockApiResponse(validStrategyCode(ARCHETYPES[i].name)) as never
      );
    }

    const result = await generateStrategies(ARCHETYPES, DEFAULT_CONFIG);

    expect(result.strategies).toHaveLength(7);
    expect(result.substitutions).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('substitutes cooperative fallback when both attempts fail', async () => {
    // First archetype: both calls fail
    mockCreate.mockRejectedValueOnce(new Error('fail 1') as never);
    mockCreate.mockRejectedValueOnce(new Error('fail 2') as never);

    // Rest succeed
    for (let i = 1; i < ARCHETYPES.length; i++) {
      mockCreate.mockResolvedValueOnce(
        mockApiResponse(validStrategyCode(ARCHETYPES[i].name)) as never
      );
    }

    const result = await generateStrategies(ARCHETYPES, DEFAULT_CONFIG);

    expect(result.strategies).toHaveLength(7);
    expect(result.substitutions).toEqual(['Greedy']);
    expect(result.strategies[0].isFallback).toBe(true);
    expect(result.strategies[0].code).toContain('sustainableShare');
  });

  it('substitutes fallback when validation fails twice', async () => {
    // First archetype: returns invalid code both times
    const invalidCode = 'const x = 5;';
    mockCreate.mockResolvedValueOnce(mockApiResponse(invalidCode) as never);
    mockCreate.mockResolvedValueOnce(mockApiResponse(invalidCode) as never);

    // Rest succeed
    for (let i = 1; i < ARCHETYPES.length; i++) {
      mockCreate.mockResolvedValueOnce(
        mockApiResponse(validStrategyCode(ARCHETYPES[i].name)) as never
      );
    }

    const result = await generateStrategies(ARCHETYPES, DEFAULT_CONFIG);

    expect(result.substitutions).toEqual(['Greedy']);
    expect(result.strategies[0].isFallback).toBe(true);
  });

  it('aborts when >= 3 strategies fail', async () => {
    // First 3 archetypes: all fail both attempts
    for (let i = 0; i < 3; i++) {
      mockCreate.mockRejectedValueOnce(new Error('fail') as never);
      mockCreate.mockRejectedValueOnce(new Error('fail') as never);
    }

    // Rest would succeed but we should abort before reaching them
    for (let i = 3; i < ARCHETYPES.length; i++) {
      mockCreate.mockResolvedValueOnce(
        mockApiResponse(validStrategyCode(ARCHETYPES[i].name)) as never
      );
    }

    await expect(generateStrategies(ARCHETYPES, DEFAULT_CONFIG))
      .rejects.toThrow(/Strategy generation failed/);
  });

  it('strips markdown code fences from response', async () => {
    const codeWithFences = '```javascript\n' + validStrategyCode('greedy') + '\n```';
    mockCreate.mockResolvedValueOnce(mockApiResponse(codeWithFences) as never);

    // Rest succeed normally
    for (let i = 1; i < ARCHETYPES.length; i++) {
      mockCreate.mockResolvedValueOnce(
        mockApiResponse(validStrategyCode(ARCHETYPES[i].name)) as never
      );
    }

    const result = await generateStrategies(ARCHETYPES, DEFAULT_CONFIG);

    expect(result.strategies[0].isFallback).toBe(false);
    expect(result.strategies[0].code).not.toContain('```');
  });
});
