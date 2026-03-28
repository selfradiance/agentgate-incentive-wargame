// Agent 006: Economy Generator
// Claude API: NormalizedScenario → JS source code conforming to GeneratedEconomy interface.
// Validator checks required exports and structural rules. Retry with errors on failure.

import type { NormalizedScenario } from './types.js';
import { getAnthropicClient } from './anthropic-client.js';
import { validateEconomyModule } from './sandbox/validator.js';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_RETRIES = 2;

// --- Prompt ---

function buildEconomyPrompt(scenario: NormalizedScenario): string {
  return `You are generating a JavaScript economy module for an economic simulation engine. The module defines the complete game state, rules, and dynamics for a specific scenario.

## Required Exports (all 6 are mandatory)
Your module MUST export exactly these 6 functions:

\`\`\`javascript
// Initialize game state from scenario definition
export function initState(scenario) {
  // Returns: { ...state object with all needed fields }
  // Must include: round (number), agentCount, per-agent arrays
}

// Advance one round: apply agent decisions to state, return new state
export function tick(state, decisions, scenario) {
  // decisions: array of { action: string, params: { ... } } per agent
  // Returns: new state object (or mutated state)
  // Must handle invalid/missing decisions gracefully (treat as no-op)
}

// Extract numeric metrics from current state
export function extractMetrics(state, scenario) {
  // Returns: { metricName: number, ... }
  // Include scenario-relevant measurements
}

// Check soft invariants (rules the model should maintain)
// Returns array of violation description strings (empty = no violations)
export function checkInvariants(state, scenario) {
  // Returns: string[]
}

// Check if the scenario has collapsed / ended early
export function isCollapsed(state, scenario) {
  // Returns: boolean
}

// Get observations for a specific agent (respecting visibility)
export function getObservations(state, agentIndex, scenario) {
  // Returns: { fieldName: value, ... }
  // Public fields: all agents see the same value
  // Private fields: only this agent's own data
}
\`\`\`

## Rules
- Use ONLY \`export function\` declarations (no default exports)
- Module-scope \`const\` is allowed for constants; \`let\` and \`var\` at module scope are NOT allowed
- No side effects, no async, no globals, no I/O, no require/import, no eval
- No Math.random, no Date, no nondeterministic inputs
- All state must flow through function parameters and return values
- Decisions that are invalid (wrong action name, out-of-range params) should be treated as no-ops
- Size limit: 20KB

## Scenario Definition
\`\`\`json
${JSON.stringify(scenario, null, 2)}
\`\`\`

## Action Schema
Agents choose ONE action per round from:
${scenario.actions.map(a => {
    const params = a.params.map(p => {
      const range = p.type === 'number' && (p.min !== undefined || p.max !== undefined)
        ? ` [${p.min ?? '?'}..${p.max ?? '?'}]`
        : '';
      return `    ${p.name}: ${p.type}${range} — ${p.description}`;
    }).join('\n');
    const roles = a.allowedRoles.length > 0 ? ` (allowed roles: ${a.allowedRoles.join(', ')})` : '';
    return `- **${a.name}**${roles}: ${a.description}\n${params}`;
  }).join('\n')}

## Observation Model
getObservations() must return these fields:
${scenario.observationModel.map(o =>
    `- ${o.name}: ${o.type} (${o.visibility}) — ${o.description}`
  ).join('\n')}

## Invariants to Enforce
${scenario.rules.map(r => `- [${r.type.toUpperCase()}] ${r.description}`).join('\n')}

## Collapse Condition
${scenario.collapseCondition}

## Success Condition
${scenario.successCondition}

## Worked Example
Here is a simplified commons economy module for reference:

\`\`\`javascript
export function initState(scenario) {
  const pool = scenario.resources[0].initialValue;
  const n = scenario.agentCount;
  return {
    pool,
    round: 0,
    agentWealth: new Array(n).fill(0),
    agentHistory: Array.from({ length: n }, () => []),
    collapsed: false,
  };
}

export function tick(state, decisions, scenario) {
  const pool = state.pool;
  const maxRate = 0.20;
  const maxExtraction = pool * maxRate;
  const extractions = decisions.map(d => {
    if (!d || d.action !== 'extract') return 0;
    const amt = Number(d.params.amount);
    if (!Number.isFinite(amt) || amt < 0) return 0;
    return Math.min(amt, maxExtraction);
  });
  const total = extractions.reduce((s, v) => s + v, 0);
  const actual = total > pool
    ? extractions.map(e => total > 0 ? (e / total) * pool : 0)
    : extractions;
  const newPool = Math.max(0, pool - actual.reduce((s, v) => s + v, 0));
  const regen = newPool * 0.10;
  const cap = scenario.resources[0].max || scenario.resources[0].initialValue;
  const finalPool = Math.min(newPool + regen, cap);
  return {
    ...state,
    pool: finalPool,
    round: state.round + 1,
    agentWealth: state.agentWealth.map((w, i) => w + actual[i]),
    agentHistory: state.agentHistory.map((h, i) => [...h, actual[i]]),
    collapsed: finalPool < 0.01,
  };
}

export function extractMetrics(state, scenario) {
  return {
    poolLevel: state.pool,
    totalWealth: state.agentWealth.reduce((s, v) => s + v, 0),
  };
}

export function checkInvariants(state, scenario) {
  const violations = [];
  if (state.pool < 0) violations.push('Pool is negative');
  return violations;
}

export function isCollapsed(state, scenario) {
  return state.collapsed === true;
}

export function getObservations(state, agentIndex, scenario) {
  return {
    poolLevel: state.pool,
    myWealth: state.agentWealth[agentIndex],
  };
}
\`\`\`

## Output
Return ONLY the JavaScript module code. No markdown, no explanation, no code fences.
Make sure all 6 exports are present and the module handles edge cases gracefully.`;
}

// --- Generation ---

export interface EconomyGenResult {
  code: string;
  validationErrors: string[];
}

export async function generateEconomyModule(scenario: NormalizedScenario): Promise<string> {
  const client = getAnthropicClient();
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const prompt = attempt === 0
      ? buildEconomyPrompt(scenario)
      : buildEconomyPrompt(scenario) + `\n\n## Previous Attempt Failed\nThe previous output had these validation errors:\n${lastErrors.map(e => `- ${e}`).join('\n')}\n\nPlease fix these issues and try again.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();

    if (!text) {
      lastErrors = ['Claude returned no text'];
      continue;
    }

    // Strip code fences if present
    const code = text
      .replace(/^```(?:javascript|js)?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();

    const validation = validateEconomyModule(code);
    if (!validation.valid) {
      lastErrors = validation.errors;
      continue;
    }

    return code;
  }

  throw new Error(
    `Economy module generation failed after ${MAX_RETRIES + 1} attempts. Last errors: ${lastErrors.join('; ')}`
  );
}
