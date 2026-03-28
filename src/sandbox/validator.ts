// Agent 006: Strategy Validator
// String-level code checks adapted for economy mode (pure-function contract).
// Economy module validation: checks required exports, blocks mutable module scope.
// Decision validation: checks action names, param types, ranges, role permissions.
// Structural lint — not a semantic guarantee. Runtime normalization is the safety net.

import { Script } from 'node:vm';
import type { ActionDef, AgentDecision, NormalizedScenario } from '../types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Blocked patterns — same foundation as 005, plus economy-specific restrictions
const BLOCKED_PATTERNS: [RegExp, string][] = [
  // No global/external access
  [/\bglobalThis\b/, 'globalThis access not allowed'],
  [/\bglobal\b(?!\.)/, 'global access not allowed'],
  [/\bwindow\b/, 'window access not allowed'],
  [/\bthis\./, 'this context not allowed'],

  // No async operations
  [/\bsetTimeout\b/, 'setTimeout not allowed'],
  [/\bsetInterval\b/, 'setInterval not allowed'],
  [/\bsetImmediate\b/, 'setImmediate not allowed'],
  [/\bPromise\b/, 'Promise not allowed'],
  [/\basync\b/, 'async not allowed'],
  [/\bawait\b/, 'await not allowed'],

  // No nondeterministic inputs
  [/\bMath\.random\s*\(/, 'Math.random not allowed'],
  [/\bDate\b/, 'Date access not allowed'],
  [/\bperformance\b/, 'performance access not allowed'],
  [/\bcrypto\b/, 'crypto access not allowed'],

  // No process/system access
  [/\bprocess\b/, 'process access not allowed'],
  [/\brequire\s*\(/, 'require not allowed'],
  [/\bimport\s*\(/, 'dynamic import not allowed'],
  [/\bimport\s+/, 'import statement not allowed'],
  [/\bexport\b/, 'export not allowed'],

  // No eval/code generation
  [/\beval\s*\(/, 'eval not allowed'],
  [/\bFunction\s*\(/, 'Function constructor not allowed'],

  // No I/O
  [/\bfetch\s*\(/, 'fetch not allowed'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest not allowed'],
  [/\bconsole\./, 'console access not allowed'],
  [/\bfs\b/, 'fs access not allowed'],
  [/\bchild_process\b/, 'child_process not allowed'],
  [/\bnet\b\./, 'net access not allowed'],
  [/\bhttp\b/, 'http not allowed'],
  [/\bdocument\b/, 'document access not allowed'],

  // No prototype pollution
  [/__proto__/, '__proto__ access not allowed'],
  [/\bconstructor\b(?!\s*\()/, 'constructor access not allowed'],
  [/\.prototype\b/, 'prototype access not allowed'],

  // No shared state mechanisms
  [/\bWeakRef\b/, 'WeakRef not allowed'],
  [/\bFinalizationRegistry\b/, 'FinalizationRegistry not allowed'],
  [/\bProxy\b/, 'Proxy not allowed'],
  [/\bReflect\b/, 'Reflect not allowed'],
  [/\bSymbol\b/, 'Symbol not allowed'],
  [/\bSharedArrayBuffer\b/, 'SharedArrayBuffer not allowed'],
  [/\bAtomics\b/, 'Atomics not allowed'],
];

const RAW_BLOCKED_PATTERNS: [RegExp, string][] = [
  [/\[['"]constructor['"]\]/, 'constructor bracket access not allowed'],
  [/\[['"]__proto__['"]\]/, '__proto__ bracket access not allowed'],
  [/\[['"]prototype['"]\]/, 'prototype bracket access not allowed'],
  [/\[[^\]]*['"][^'"\]]*['"]\s*\+\s*['"][^'"\]]*['"][^\]]*\]/, 'string-concatenated property access not allowed'],
];

export function validateStrategy(code: string): ValidationResult {
  const errors: string[] = [];
  const trimmed = code.trim();

  // Structural check: must match function signature
  const sigMatch = trimmed.match(/^function\s+\w+\s*\(\s*state\s*\)\s*\{/);
  if (!sigMatch) {
    errors.push('Strategy must match: function <name>(state) { ... }');
  }

  // Structural check: must contain at least one return statement
  if (!/\breturn\b/.test(trimmed)) {
    errors.push('Strategy must contain at least one return statement');
  }

  try {
    new Script(`(${trimmed})`);
  } catch {
    errors.push('Strategy must be exactly one function declaration with no extra top-level code');
  }

  // Check blocked patterns
  // Strip string literals and comments to avoid false positives
  const stripped = trimmed
    .replace(/\/\/.*$/gm, '')           // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')   // multi-line comments
    .replace(/'(?:[^'\\]|\\.)*'/g, '""')  // single-quoted strings
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')  // double-quoted strings
    .replace(/`(?:[^`\\]|\\.)*`/g, '""'); // template literals

  for (const [pattern, message] of BLOCKED_PATTERNS) {
    if (pattern.test(stripped)) {
      errors.push(message);
    }
  }

  for (const [pattern, message] of RAW_BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      errors.push(message);
    }
  }

  return { valid: errors.length === 0, errors };
}

// --- Economy Module Validation ---

const ECONOMY_MAX_SIZE = 20 * 1024; // 20KB
const REQUIRED_EXPORTS = ['initState', 'tick', 'extractMetrics', 'checkInvariants', 'isCollapsed', 'getObservations'];

// Blocked patterns for economy modules — same security rules as strategies
// but exports are allowed (required), and module-scope const is allowed.
const ECONOMY_BLOCKED_PATTERNS: [RegExp, string][] = BLOCKED_PATTERNS.filter(
  ([_, msg]) => msg !== 'export not allowed'
);

export function validateEconomyModule(code: string): ValidationResult {
  const errors: string[] = [];
  const trimmed = code.trim();

  // Size check
  if (trimmed.length > ECONOMY_MAX_SIZE) {
    errors.push(`Economy module exceeds ${ECONOMY_MAX_SIZE} byte limit (${trimmed.length} bytes)`);
  }

  // Check required exports
  for (const name of REQUIRED_EXPORTS) {
    // Accept: export function name, export const name, exports.name
    const exportPattern = new RegExp(
      `(?:export\\s+(?:function|const)\\s+${name}\\b)|(?:exports\\.${name}\\s*=)`
    );
    if (!exportPattern.test(trimmed)) {
      errors.push(`Missing required export: ${name}`);
    }
  }

  // Block mutable module-scope variables (let/var at top level)
  // Simple heuristic: let/var at the start of a line or after a semicolon at top scope
  // This catches common cases. Module-scope const is allowed.
  const lines = trimmed.split('\n');
  let braceDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Track brace depth (rough — ignores braces in strings/comments, but catches obvious cases)
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    }
    // At module scope (depth 0 after processing line, or depth 1 if line opens a function)
    // Check for let/var declarations at the start of a line at depth 0
    const trimmedLine = line.trim();
    if (braceDepth === 0) {
      if (/^(let|var)\s+/.test(trimmedLine)) {
        errors.push(`Mutable module-scope variable not allowed (line ${i + 1}): ${trimmedLine.substring(0, 40)}`);
      }
    }
  }

  // Syntax check — try to parse as module
  try {
    new Script(trimmed);
  } catch {
    // May fail because of export keyword — try wrapping
    try {
      new Script(trimmed.replace(/\bexport\s+/g, ''));
    } catch (e) {
      errors.push(`Syntax error: ${(e as Error).message}`);
    }
  }

  // Security check — apply blocked patterns (minus 'export not allowed')
  const stripped = trimmed
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '""');

  for (const [pattern, message] of ECONOMY_BLOCKED_PATTERNS) {
    if (pattern.test(stripped)) {
      errors.push(message);
    }
  }

  for (const [pattern, message] of RAW_BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      errors.push(message);
    }
  }

  return { valid: errors.length === 0, errors };
}

// --- Decision Validation ---

export function validateDecision(
  decision: unknown,
  scenario: NormalizedScenario,
  agentIndex: number,
  agentRole?: string,
): ValidationResult {
  const errors: string[] = [];

  if (typeof decision !== 'object' || decision === null) {
    return { valid: false, errors: ['Decision must be a non-null object'] };
  }

  const d = decision as Record<string, unknown>;

  // Check action name
  if (typeof d.action !== 'string') {
    return { valid: false, errors: ['Decision.action must be a string'] };
  }

  const actionDef = scenario.actions.find(a => a.name === d.action);
  if (!actionDef) {
    errors.push(`Unknown action: "${d.action}". Valid actions: ${scenario.actions.map(a => a.name).join(', ')}`);
    return { valid: false, errors };
  }

  // Check role permissions
  if (actionDef.allowedRoles.length > 0 && agentRole) {
    if (!actionDef.allowedRoles.includes(agentRole)) {
      errors.push(`Agent ${agentIndex} (role: ${agentRole}) is not allowed to perform action "${d.action}". Allowed roles: ${actionDef.allowedRoles.join(', ')}`);
    }
  }

  // Check params
  if (typeof d.params !== 'object' || d.params === null) {
    errors.push('Decision.params must be a non-null object');
    return { valid: false, errors };
  }

  const params = d.params as Record<string, unknown>;

  for (const paramDef of actionDef.params) {
    const val = params[paramDef.name];

    if (val === undefined) {
      errors.push(`Missing param "${paramDef.name}" for action "${actionDef.name}"`);
      continue;
    }

    // Type check
    if (paramDef.type === 'number') {
      if (typeof val !== 'number' || !Number.isFinite(val as number)) {
        errors.push(`Param "${paramDef.name}" must be a finite number, got ${typeof val === 'number' ? val : typeof val}`);
        continue;
      }
      // Range check
      if (paramDef.min !== undefined && (val as number) < paramDef.min) {
        errors.push(`Param "${paramDef.name}" value ${val} is below minimum ${paramDef.min}`);
      }
      if (paramDef.max !== undefined && (val as number) > paramDef.max) {
        errors.push(`Param "${paramDef.name}" value ${val} exceeds maximum ${paramDef.max}`);
      }
    } else if (paramDef.type === 'string') {
      if (typeof val !== 'string') {
        errors.push(`Param "${paramDef.name}" must be a string, got ${typeof val}`);
      }
    } else if (paramDef.type === 'boolean') {
      if (typeof val !== 'boolean') {
        errors.push(`Param "${paramDef.name}" must be a boolean, got ${typeof val}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
