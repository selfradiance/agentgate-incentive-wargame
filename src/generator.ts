// Agent 006: Strategy Generator
// Claude API: archetype descriptions + game rules + strategy contract → validated JS functions.
// Retry logic, cooperative fallback substitution with prominent logging.

import type { Archetype, Strategy, GameConfig, NormalizedScenario } from './types.js';
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
): Promise<{ code: string; validationErrors: string[] }> {
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

  if (!text) {
    throw new Error('Claude returned no strategy text');
  }

  // Strip code fences if Claude included them despite instructions
  const code = text
    .replace(/^```(?:javascript|js)?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();

  const validation = validateStrategy(code);
  return { code, validationErrors: validation.errors };
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
    // Early abort: stop making API calls if already at failure threshold
    if (failCount >= 3) break;

    let code: string | null = null;
    let validationErrors: string[] = [];

    // Attempt 1
    try {
      const result = await generateSingleStrategy(archetype, config);
      code = result.code;
      validationErrors = result.validationErrors;
      if (validationErrors.length > 0) {
        errors.push(`${archetype.name}: Validation failed on attempt 1 — ${validationErrors.join('; ')}`);
      }
    } catch (err) {
      errors.push(`${archetype.name}: API call failed — ${(err as Error).message}`);
    }

    // Attempt 2 (retry) if first failed or didn't validate
    if (validationErrors.length > 0 || !code) {
      try {
        const result = await generateSingleStrategy(archetype, config);
        code = result.code;
        validationErrors = result.validationErrors;
        if (validationErrors.length > 0) {
          errors.push(`${archetype.name}: Validation failed on retry — ${validationErrors.join('; ')}`);
        }
      } catch (err) {
        errors.push(`${archetype.name}: Retry API call failed — ${(err as Error).message}`);
      }
    }

    if (validationErrors.length === 0 && code) {
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

// --- v0.3.0: Scenario-Aware Strategy Generation ---

function buildScenarioPrompt(archetype: Archetype, scenario: NormalizedScenario): string {
  const actionDescriptions = scenario.actions.map(a => {
    const params = a.params.map(p => {
      const range = p.type === 'number' && (p.min !== undefined || p.max !== undefined)
        ? ` [${p.min ?? '?'}..${p.max ?? '?'}]`
        : '';
      return `  - ${p.name}: ${p.type}${range} — ${p.description}`;
    }).join('\n');
    const roles = a.allowedRoles.length > 0 ? ` (allowed roles: ${a.allowedRoles.join(', ')})` : '';
    return `- ${a.name}${roles}: ${a.description}\n${params}`;
  }).join('\n');

  const observationFields = scenario.observationModel.map(o =>
    `  ${o.name}: ${o.type}, // ${o.visibility} — ${o.description}`
  ).join('\n');

  return `You are generating a JavaScript strategy function for an economic simulation game.

## Scenario
**Name:** ${scenario.name}
**Description:** ${scenario.description}
**Agents:** ${scenario.agentCount}

## Available Actions (ONE per round per agent)
${actionDescriptions}

## Strategy Output Contract
Your function MUST return an AgentDecision object:
\`\`\`javascript
{ action: "actionName", params: { paramName: value, ... } }
\`\`\`

The agent takes EXACTLY ONE action per round. The decision must reference an action name from the available actions above, with all required params matching the specified types and ranges.

## State Object (what your function receives)
\`\`\`javascript
{
  agentIndex: number,      // this agent's index (0-based)
  agentCount: number,      // total number of agents
  round: number,           // current round (1-indexed)
  totalRounds: number,     // total rounds in simulation
  // Observation fields from the scenario:
${observationFields}
}
\`\`\`

## Rules
- Be a pure function with signature: function <name>(state) { ... }
- Return an object: { action: string, params: { ... } }
- Use NO side effects, NO async, NO globals, NO I/O, NO console, NO require/import
- Invalid decisions (wrong action, missing params) are treated as no-ops

## Your Archetype
**Name:** ${archetype.name}
**Strategy:** ${archetype.description}

## Output
Return ONLY the function code. No markdown, no explanation, no code fences.
The function name should be \`${archetype.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}\`.

Example format:
function ${archetype.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}(state) {
  // your logic here
  return { action: "actionName", params: { paramName: value } };
}`;
}

function scenarioFallback(archetypeName: string, scenario: NormalizedScenario): string {
  const fnName = archetypeName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const firstAction = scenario.actions[0];
  // Build a conservative/minimal fallback: use the first action with minimal params
  const paramDefaults = firstAction.params.map(p => {
    if (p.type === 'number') {
      // Use the midpoint or minimum as a conservative default
      const min = p.min ?? 0;
      const max = p.max ?? min;
      return `${p.name}: ${min + (max - min) * 0.1}`;
    }
    if (p.type === 'boolean') return `${p.name}: false`;
    return `${p.name}: ""`;
  }).join(', ');

  return `function ${fnName}(state) {
  return { action: "${firstAction.name}", params: { ${paramDefaults} } };
}`;
}

async function generateSingleScenarioStrategy(
  archetype: Archetype,
  scenario: NormalizedScenario,
): Promise<{ code: string; validationErrors: string[] }> {
  const client = getAnthropicClient();
  const prompt = buildScenarioPrompt(archetype, scenario);

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

  if (!text) {
    throw new Error('Claude returned no strategy text');
  }

  const code = text
    .replace(/^```(?:javascript|js)?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();

  const validation = validateStrategy(code);
  return { code, validationErrors: validation.errors };
}

export async function generateScenarioStrategies(
  archetypes: Archetype[],
  scenario: NormalizedScenario,
): Promise<GenerationResult> {
  const strategies: Strategy[] = [];
  const substitutions: string[] = [];
  const errors: string[] = [];
  let failCount = 0;

  for (const archetype of archetypes) {
    if (failCount >= 3) break;

    let code: string | null = null;
    let validationErrors: string[] = [];

    // Attempt 1
    try {
      const result = await generateSingleScenarioStrategy(archetype, scenario);
      code = result.code;
      validationErrors = result.validationErrors;
      if (validationErrors.length > 0) {
        errors.push(`${archetype.name}: Validation failed on attempt 1 — ${validationErrors.join('; ')}`);
      }
    } catch (err) {
      errors.push(`${archetype.name}: API call failed — ${(err as Error).message}`);
    }

    // Attempt 2
    if (validationErrors.length > 0 || !code) {
      try {
        const result = await generateSingleScenarioStrategy(archetype, scenario);
        code = result.code;
        validationErrors = result.validationErrors;
        if (validationErrors.length > 0) {
          errors.push(`${archetype.name}: Validation failed on retry — ${validationErrors.join('; ')}`);
        }
      } catch (err) {
        errors.push(`${archetype.name}: Retry API call failed — ${(err as Error).message}`);
      }
    }

    if (validationErrors.length === 0 && code) {
      strategies.push({
        archetypeIndex: archetype.index,
        archetypeName: archetype.name,
        code,
        isFallback: false,
      });
    } else {
      failCount++;
      const fallbackCode = scenarioFallback(archetype.name, scenario);
      substitutions.push(archetype.name);
      errors.push(`${archetype.name}: Substituted with conservative fallback.`);

      strategies.push({
        archetypeIndex: archetype.index,
        archetypeName: archetype.name,
        code: fallbackCode,
        isFallback: true,
      });
    }
  }

  if (failCount >= 3) {
    throw new Error(
      `Strategy generation failed: ${failCount} of ${archetypes.length} strategies could not be generated. ` +
      `Aborting. Failed: ${substitutions.join(', ')}`
    );
  }

  return { strategies, substitutions, errors };
}
