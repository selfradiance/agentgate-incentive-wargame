import { describe, it, expect } from 'vitest';
import { runSimulation } from './runner.js';
import { ARCHETYPES } from './archetypes.js';
import { FIXTURE_STRATEGIES } from './fixtures.js';
import type { Strategy, Archetype } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

function fixtureStrategies(): Strategy[] {
  return FIXTURE_STRATEGIES.map((fn, i) => ({
    archetypeIndex: i,
    archetypeName: ARCHETYPES[i].name,
    code: fn.toString(),
    isFallback: false,
  }));
}

describe('Permutation invariance — simultaneous-move semantics', () => {
  it('produces identical results regardless of strategy execution order', async () => {
    const config = { ...DEFAULT_CONFIG, rounds: 20 };
    const strategies = fixtureStrategies();

    // Run 1: normal order [0,1,2,3,4,5,6]
    const log1 = await runSimulation({
      config,
      archetypes: ARCHETYPES,
      strategies,
    });

    // Run 2: reversed order [6,5,4,3,2,1,0]
    const reversedArchetypes: Archetype[] = [...ARCHETYPES].reverse().map((a, i) => ({ ...a, index: i }));
    const reversedStrategies: Strategy[] = [...strategies].reverse().map((s, i) => ({
      ...s,
      archetypeIndex: i,
    }));

    const log2 = await runSimulation({
      config,
      archetypes: reversedArchetypes,
      strategies: reversedStrategies,
    });

    // Both should run the same number of rounds
    expect(log1.rounds.length).toBe(log2.rounds.length);

    // Pool trajectory should be identical
    for (let r = 0; r < log1.rounds.length; r++) {
      expect(log1.rounds[r].poolAfter).toBe(log2.rounds[r].poolAfter);
      expect(log1.rounds[r].poolBefore).toBe(log2.rounds[r].poolBefore);
    }

    // Per-agent extractions should match (mapping original index to reversed index)
    // Original agent i = Reversed agent (6 - i)
    for (let r = 0; r < log1.rounds.length; r++) {
      for (let i = 0; i < 7; i++) {
        const reversedIdx = 6 - i;
        expect(log1.rounds[r].actual[i]).toBe(log2.rounds[r].actual[reversedIdx]);
      }
    }

    // Total wealth per archetype should match
    for (let i = 0; i < 7; i++) {
      const reversedIdx = 6 - i;
      expect(log1.finalState.agentWealth[i]).toBe(log2.finalState.agentWealth[reversedIdx]);
    }

    // Collapse state should match
    expect(log1.finalState.collapsed).toBe(log2.finalState.collapsed);
    expect(log1.finalState.collapseRound).toBe(log2.finalState.collapseRound);
  }, 30000);
});
