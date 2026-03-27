import { describe, it, expect } from 'vitest';
import { validateStrategy } from './validator.js';

describe('validateStrategy', () => {
  const validCode = `function greedy(state) {
  return state.maxExtraction;
}`;

  it('accepts a valid strategy', () => {
    const result = validateStrategy(validCode);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing function signature', () => {
    const result = validateStrategy('const x = 5; return x;');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('function'))).toBe(true);
  });

  it('rejects missing return statement', () => {
    const result = validateStrategy('function test(state) { state.maxExtraction; }');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('return'))).toBe(true);
  });

  it('rejects extra top-level code after the function', () => {
    const result = validateStrategy('function test(state) { return 0; } while (true) {}');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('exactly one function declaration'))).toBe(true);
  });

  // Blocked patterns
  const blockedCases: [string, string][] = [
    ['function t(state) { return globalThis.x; }', 'globalThis'],
    ['function t(state) { return this.x; }', 'this'],
    ['function t(state) { setTimeout(() => {}, 0); return 0; }', 'setTimeout'],
    ['function t(state) { setInterval(() => {}, 0); return 0; }', 'setInterval'],
    ['function t(state) { return new Promise(r => r(0)); }', 'Promise'],
    ['function t(state) { return eval("1"); }', 'eval'],
    ['function t(state) { return process.env.X; }', 'process'],
    ['function t(state) { return require("fs"); }', 'require'],
    ['function t(state) { return fetch("http://x"); }', 'fetch'],
    ['function t(state) { console.log(1); return 0; }', 'console'],
    ['function t(state) { return Function("return 1")(); }', 'Function'],
    ['async function t(state) { return 0; }', 'async'],
    ['function t(state) { return Math.random(); }', 'Math.random'],
    ['function t(state) { return Date.now(); }', 'Date'],
  ];

  for (const [code, pattern] of blockedCases) {
    it(`blocks ${pattern}`, () => {
      const result = validateStrategy(code);
      expect(result.valid).toBe(false);
    });
  }

  it('allows Math operations', () => {
    const code = 'function t(state) { return Math.min(state.sustainableShare, state.maxExtraction); }';
    const result = validateStrategy(code);
    expect(result.valid).toBe(true);
  });

  it('allows array methods', () => {
    const code = 'function t(state) { return state.myHistory.reduce((a, b) => a + b, 0); }';
    const result = validateStrategy(code);
    expect(result.valid).toBe(true);
  });

  it('allows state access', () => {
    const code = `function t(state) {
  const share = state.poolLevel * state.regenerationRate / state.agentCount;
  return Math.min(share, state.maxExtraction);
}`;
    const result = validateStrategy(code);
    expect(result.valid).toBe(true);
  });

  it('does not false-positive on blocked words in strings', () => {
    const code = `function t(state) {
  var x = "this is a process with setTimeout";
  return state.maxExtraction;
}`;
    const result = validateStrategy(code);
    expect(result.valid).toBe(true);
  });

  it('rejects bracket access to constructor gadgets', () => {
    const code = `function t(state) {
  return []['filter']['constructor']('return 1')();
}`;
    const result = validateStrategy(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('constructor bracket access'))).toBe(true);
  });
});
