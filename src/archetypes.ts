// Agent 006: Archetype Definitions
// Plain-English descriptions used for Claude strategy generation prompts.

import type { Archetype } from './types.js';

export const ARCHETYPES: Archetype[] = [
  {
    index: 0,
    name: 'Greedy',
    description: 'Always extracts the maximum allowed. Pure short-term optimization.',
  },
  {
    index: 1,
    name: 'Cooperative',
    description: 'Extracts only their sustainable share (MSY / agentCount) or less. Prioritizes pool survival.',
  },
  {
    index: 2,
    name: 'Retaliator',
    description: 'Starts cooperative. If any agent extracted above sustainable share last round, switches to max extraction permanently. Grim trigger punishment.',
  },
  {
    index: 3,
    name: 'Forgiver',
    description: 'Starts cooperative. If any other agent extracted above sustainable share last round, extracts max next round as punishment — but returns to cooperation if the round after punishment shows all other agents below sustainable share. Excludes own extraction from the check. Tit-for-tat with de-escalation.',
  },
  {
    index: 4,
    name: 'Opportunist',
    description: 'Cooperates while the pool is above 50% of starting value. Once it drops below 50%, switches to max extraction ("take what you can before it\'s gone").',
  },
  {
    index: 5,
    name: 'Adaptive',
    description: 'Watches the pool trend over the last 3 rounds. If pool is growing or stable, extracts sustainable share. If pool is declining, increases extraction proportionally to the decline rate (hedging against collapse).',
  },
  {
    index: 6,
    name: 'Stabilizer',
    description: 'Targets a sustainable yield band. Calculates the extraction amount that would keep the pool at its current level given the regeneration rate, and extracts exactly that. Active stewardship — tries to maintain the commons, not just cooperate passively.',
  },
];
