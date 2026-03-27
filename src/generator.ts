// Agent 006: Strategy Generator
// Claude API: archetype descriptions + game rules + strategy contract → validated JS functions.
// Retry logic, cooperative fallback substitution with prominent logging.

import type { Archetype, Strategy, GameConfig } from './types.js';
import { validateStrategy } from './sandbox/validator.js';
import { getAnthropicClient } from './anthropic-client.js';

const MODEL = 'claude-sonnet-4-20250514';

function buildPrompt(archetype: Archetype, config: GameConfig): string {
  return `You are generating a JavaScript strategy function for an economic simulation game (Tragedy of the Commons).

## Game Rules
- There is a shared resource pool (starting at ${config.poolSize}).
- Each round, ${config.agentCount} agents simultaneously decide how much to extract (0 to maxExtraction).
- If total extraction exceeds the pool, it is distributed pro-rata.
- After extraction, the pool regenerates by ${config.regenerationRate * 100}% of what remains.
- The pool cannot exceed ${config.poolSize} (carrying capacity).
- If the pool drops below 0.01, the game ends (commons collapsed).
- The simulation runs for ${config.rounds} rounds.

## Strategy Contract
Your function MUST:
- Be a pure function with signature: function <name>(state) { ... }
- Accept a single \`state\` parameter (read-only object)
- Return a number (the extraction amount)
- Use NO side effects, NO async, NO globals, NO I/O, NO console, NO require/import

## State Object
\`\`\`javascript
{
  round: number,           // current round (1-indexed)
  totalRounds: number,     // total rounds in simulation
  poolLevel: number,       // current pool level
  startingPoolSize: number,// initial pool size (carrying capacity)
  regenerationRate: number,// pool regeneration rate
  maxExtraction: number,   // maximum allowed extraction THIS round
  agentCount: number,      // number of agents
  agentIndex: number,      // this agent's index (0-based)
  myWealth: number,        // this agent's accumulated wealth
  myHistory: number[],     // this agent's past extractions
  allHistory: number[][],  // all agents' past extractions
  poolHistory: number[],   // pool level at start of each prior round
  sustainableShare: number // MSY per agent this round
}
\`\`\`

## Return Value Rules
- Valid number >= 0 and <= maxExtraction: accepted
- Number > maxExtraction: clamped to maxExtraction
- Negative, NaN, Infinity, non-number: treated as 0
- Thrown error: treated as 0

## Your Archetype
**Name:** ${archetype.name}
**Strategy:** ${archetype.description}

## Output
Return ONLY the function code. No markdown, no explanation, no code fences.
The function name should be \`${archetype.name.toLowerCase()}\`.

Example format:
function ${archetype.name.toLowerCase()}(state) {
  // your logic here
  return amount;
}`;
}

function cooperativeFallback(archetypeName: string): string {
  const fnName = archetypeName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `function ${fnName}(state) {
  return Math.min(state.sustainableShare, state.maxExtraction);
}`;
}

async function generateSingleStrategy(
  archetype: Archetype,
  config: GameConfig,
): Promise<{ code: string; validated: boolean }> {
  const client = getAnthropicClient();
  const prompt = buildPrompt(archetype, config);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim();

  // Strip code fences if Claude included them despite instructions
  const code = text
    .replace(/^```(?:javascript|js)?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();

  const validation = validateStrategy(code);
  return { code, validated: validation.valid };
}

export interface GenerationResult {
  strategies: Strategy[];
  substitutions: string[];  // Archetype names that were replaced with fallbacks
  errors: string[];         // Non-fatal errors encountered
}

export async function generateStrategies(
  archetypes: Archetype[],
  config: GameConfig,
): Promise<GenerationResult> {
  const strategies: Strategy[] = [];
  const substitutions: string[] = [];
  const errors: string[] = [];
  let failCount = 0;

  for (const archetype of archetypes) {
    let code: string | null = null;
    let validated = false;

    // Attempt 1
    try {
      const result = await generateSingleStrategy(archetype, config);
      code = result.code;
      validated = result.validated;
    } catch (err) {
      errors.push(`${archetype.name}: API call failed — ${(err as Error).message}`);
    }

    // Attempt 2 (retry) if first failed or didn't validate
    if (!validated) {
      try {
        const result = await generateSingleStrategy(archetype, config);
        code = result.code;
        validated = result.validated;
      } catch (err) {
        errors.push(`${archetype.name}: Retry API call failed — ${(err as Error).message}`);
      }
    }

    if (validated && code) {
      strategies.push({
        archetypeIndex: archetype.index,
        archetypeName: archetype.name,
        code,
        isFallback: false,
      });
    } else {
      // Substitute cooperative fallback
      failCount++;
      const fallbackCode = cooperativeFallback(archetype.name);
      substitutions.push(archetype.name);
      errors.push(`${archetype.name}: Substituted with cooperative fallback after generation/validation failure.`);

      strategies.push({
        archetypeIndex: archetype.index,
        archetypeName: archetype.name,
        code: fallbackCode,
        isFallback: true,
      });
    }
  }

  // Abort if >= 3 strategies failed
  if (failCount >= 3) {
    throw new Error(
      `Strategy generation failed: ${failCount} of ${archetypes.length} strategies could not be generated. ` +
      `Aborting. Failed: ${substitutions.join(', ')}`
    );
  }

  return { strategies, substitutions, errors };
}
