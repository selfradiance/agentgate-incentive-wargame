// Agent 006: Strategy Validator
// String-level code checks adapted for economy mode (pure-function contract).
// Structural lint — not a semantic guarantee. Runtime normalization is the safety net.

import { Script } from 'node:vm';

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
