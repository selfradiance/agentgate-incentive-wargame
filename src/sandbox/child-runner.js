// Agent 006: Child Runner
// Runs inside a permission-restricted child process.
// Strategy VM: each strategy executes in a fresh vm context with string code generation disabled.
// Economy VM: generated economy modules are evaluated in a fresh vm context per call.
// v0.3.0: Two VM contexts — one for economy, one for strategies.

import { Script, createContext } from 'node:vm';

const STRATEGY_TIMEOUT_MS = 250;
const ECONOMY_TIMEOUT_MS = 500;

const safeProcess = {
  on: process.on.bind(process),
  send: process.send ? process.send.bind(process) : null,
};

const SANDBOX_GLOBAL_NAMES = [
  'process',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'console',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'Function',
  'eval',
  'Promise',
  'Date',
  'performance',
  'crypto',
  'Proxy',
  'Reflect',
  'Symbol',
  'WeakRef',
  'FinalizationRegistry',
  'SharedArrayBuffer',
  'Atomics',
];

for (const name of SANDBOX_GLOBAL_NAMES) {
  try {
    globalThis[name] = undefined;
  } catch {
    // Ignore readonly globals.
  }
}

const SCRIPT_CACHE = new Map();
const REQUIRED_ECONOMY_EXPORTS = ['initState', 'tick', 'extractMetrics', 'checkInvariants', 'isCollapsed', 'getObservations'];

function createSandboxGlobals(extra = {}) {
  const globals = { ...extra };
  for (const name of SANDBOX_GLOBAL_NAMES) {
    globals[name] = undefined;
  }
  return globals;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNumberArray(value, expectedLength) {
  return Array.isArray(value)
    && value.length === expectedLength
    && value.every(isFiniteNumber);
}

function isHistoryMatrix(value, expectedLength) {
  return Array.isArray(value)
    && value.length === expectedLength
    && value.every(entry => Array.isArray(entry) && entry.every(isFiniteNumber));
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

function serializeAcrossBoundary(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    throw new Error(`${label} is not JSON-serializable: ${err?.message || String(err)}`);
  }
}

function findMatchingBraceEnd(code, openingBraceIndex) {
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = openingBraceIndex + 1; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inSingle) {
      if (ch === '\\') escaped = true;
      else if (ch === '\'') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') escaped = true;
      else if (ch === '`') inTemplate = false;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '\'') {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      continue;
    }
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function isExactlyOneStrategyFunction(code) {
  const signature = /^function\s+\w+\s*\(\s*state\s*\)\s*\{/u.exec(code);
  if (!signature) return false;

  const openingBraceIndex = code.indexOf('{', signature.index);
  if (openingBraceIndex < 0) return false;

  const closingBraceIndex = findMatchingBraceEnd(code, openingBraceIndex);
  if (closingBraceIndex < 0) return false;

  return code.slice(closingBraceIndex + 1).trim().length === 0;
}

function getStrategyScript(strategyCode) {
  let cached = SCRIPT_CACHE.get(strategyCode);
  if (cached) return cached;

  if (!isExactlyOneStrategyFunction(strategyCode.trim())) {
    throw new Error('Strategy must be exactly one function declaration with no extra top-level code');
  }

  const script = new Script(`
    'use strict';
    const deepFreeze = ${deepFreeze.toString()};
    const strategy = (${strategyCode});
    if (typeof strategy !== 'function') {
      throw new Error('Strategy did not evaluate to a function');
    }
    const state = deepFreeze(JSON.parse(stateJson));
    strategy(state);
  `);

  cached = { script };
  SCRIPT_CACHE.set(strategyCode, cached);
  return cached;
}

function executeStrategy(strategyCode, agentState) {
  const { script } = getStrategyScript(strategyCode);
  const context = createContext(
    createSandboxGlobals({ stateJson: JSON.stringify(agentState) }),
    { codeGeneration: { strings: false, wasm: false } },
  );

  return script.runInContext(context, { timeout: STRATEGY_TIMEOUT_MS });
}

function executeRound(strategies, state) {
  const extractions = [];

  for (let i = 0; i < strategies.length; i++) {
    try {
      const agentState = {
        round: state.round,
        totalRounds: state.totalRounds,
        poolLevel: state.poolLevel,
        startingPoolSize: state.startingPoolSize,
        regenerationRate: state.regenerationRate,
        maxExtraction: state.maxExtraction,
        agentCount: state.agentCount,
        agentIndex: i,
        myWealth: state.agentWealth[i],
        myHistory: state.agentHistory[i],
        allHistory: state.agentHistory,
        poolHistory: state.poolHistory,
        sustainableShare: state.sustainableShare,
      };

      const result = serializeAcrossBoundary(
        executeStrategy(strategies[i], agentState),
        `Extraction result for agent ${i}`,
      );
      extractions.push(result);
    } catch (err) {
      extractions.push({ error: err?.message || String(err), agentIndex: i });
    }
  }

  return extractions;
}

function isValidExecuteState(state, strategyCount) {
  return isPlainObject(state)
    && Number.isInteger(state.round)
    && state.round >= 1
    && Number.isInteger(state.totalRounds)
    && state.totalRounds >= state.round
    && isFiniteNumber(state.poolLevel)
    && state.poolLevel >= 0
    && isFiniteNumber(state.startingPoolSize)
    && state.startingPoolSize > 0
    && isFiniteNumber(state.regenerationRate)
    && state.regenerationRate >= 0
    && state.regenerationRate <= 1
    && isFiniteNumber(state.maxExtraction)
    && state.maxExtraction >= 0
    && Number.isInteger(state.agentCount)
    && state.agentCount === strategyCount
    && state.agentCount >= 1
    && isNumberArray(state.agentWealth, state.agentCount)
    && isHistoryMatrix(state.agentHistory, state.agentCount)
    && Array.isArray(state.poolHistory)
    && state.poolHistory.every(isFiniteNumber)
    && isFiniteNumber(state.sustainableShare)
    && state.sustainableShare >= 0;
}

function isExecuteRoundMessage(msg) {
  return isPlainObject(msg)
    && msg.type === 'execute_round'
    && Number.isInteger(msg.requestId)
    && Array.isArray(msg.strategies)
    && msg.strategies.every(strategy => typeof strategy === 'string')
    && isValidExecuteState(msg.state, msg.strategies.length);
}

// --- Economy VM Context (v0.3.0) ---

let economyModuleScript = null;

function evaluateEconomyModule() {
  if (!economyModuleScript) {
    throw new Error('Economy module not loaded');
  }

  const ctx = createContext(
    createSandboxGlobals({ exports: {} }),
    { codeGeneration: { strings: false, wasm: false } },
  );

  economyModuleScript.runInContext(ctx, { timeout: ECONOMY_TIMEOUT_MS });

  const missing = REQUIRED_ECONOMY_EXPORTS.filter(name => typeof ctx.exports[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(`Economy module missing exports: ${missing.join(', ')}`);
  }

  return ctx.exports;
}

function loadEconomyModule(code) {
  // Compile and run the economy module code to populate exports
  // Replace 'export function X' with 'exports.X = function X' for VM compatibility
  const moduleCode = code.replace(/export\s+function\s+(\w+)/g, 'exports.$1 = function $1');
  // Also handle 'export const X = ...'
  const finalCode = moduleCode.replace(/export\s+const\s+(\w+)/g, 'exports.$1');

  const script = new Script(`'use strict';\n${finalCode}`);
  economyModuleScript = script;
  evaluateEconomyModule();
}

const ALLOWED_ECONOMY_FUNCTIONS = new Set(['initState', 'tick', 'extractMetrics', 'checkInvariants', 'isCollapsed', 'getObservations']);

function callEconomyFunction(fnName, args) {
  if (!ALLOWED_ECONOMY_FUNCTIONS.has(fnName)) {
    throw new Error(`Economy function ${fnName} is not an allowed export`);
  }

  // Serialize args through JSON to prevent context leakage
  const safeArgs = serializeAcrossBoundary(args, `Arguments for ${fnName}`);
  const economyFunctions = evaluateEconomyModule();

  const result = economyFunctions[fnName](...safeArgs);

  // Serialize result through JSON to prevent context leakage
  return serializeAcrossBoundary(result, `Result from ${fnName}`);
}

// Execute strategies with observation-based state (scenario mode)
// Returns AgentDecision objects instead of raw numbers
function executeScenarioStrategies(strategies, observations, scenario) {
  const decisions = [];

  for (let i = 0; i < strategies.length; i++) {
    try {
      // Build observation state for this agent
      const obs = observations[i];
      const stateForAgent = {
        ...obs,
        agentIndex: i,
        agentCount: scenario.agentCount,
        round: obs._round || 1,
        totalRounds: obs._totalRounds || 50,
      };

      // Execute strategy in fresh VM context (same as regular strategies)
      const result = serializeAcrossBoundary(
        executeStrategy(strategies[i], stateForAgent),
        `Scenario strategy result for agent ${i}`,
      );

      // Strategy should return an AgentDecision object: { action: string, params: {} }
      if (result && typeof result === 'object' && typeof result.action === 'string') {
        decisions.push(result);
      } else if (typeof result === 'number') {
        // Backward compatibility: if strategy returns a number, wrap as extract decision
        decisions.push({ action: 'extract', params: { amount: result } });
      } else {
        decisions.push({ error: 'Strategy did not return a valid decision', agentIndex: i });
      }
    } catch (err) {
      decisions.push({ error: err?.message || String(err), agentIndex: i });
    }
  }

  return decisions;
}

safeProcess.on('message', (msg) => {
  if (isExecuteRoundMessage(msg)) {
    const result = executeRound(msg.strategies, msg.state);
    safeProcess.send?.({
      type: 'round_result',
      requestId: msg.requestId,
      extractions: result,
    });
    return;
  }

  // v0.3.0: Load economy module
  if (isPlainObject(msg) && msg.type === 'load_economy' && Number.isInteger(msg.requestId)) {
    try {
      if (typeof msg.code !== 'string' || msg.code.length === 0) {
        throw new Error('Economy module code must be a non-empty string');
      }
      loadEconomyModule(msg.code);
      safeProcess.send?.({
        type: 'economy_loaded',
        requestId: msg.requestId,
        success: true,
      });
    } catch (err) {
      safeProcess.send?.({
        type: 'economy_loaded',
        requestId: msg.requestId,
        success: false,
        error: err?.message || String(err),
      });
    }
    return;
  }

  // v0.3.0: Call economy function (initState, tick, extractMetrics, etc.)
  if (isPlainObject(msg) && msg.type === 'economy_call' && Number.isInteger(msg.requestId)) {
    if (typeof msg.fnName !== 'string') {
      safeProcess.send?.({
        type: 'economy_call_result',
        requestId: msg.requestId,
        success: false,
        error: 'fnName must be a string',
      });
      return;
    }
    try {
      const result = callEconomyFunction(msg.fnName, msg.args || []);
      safeProcess.send?.({
        type: 'economy_call_result',
        requestId: msg.requestId,
        success: true,
        result,
      });
    } catch (err) {
      safeProcess.send?.({
        type: 'economy_call_result',
        requestId: msg.requestId,
        success: false,
        error: err?.message || String(err),
      });
    }
    return;
  }

  // v0.3.0: Execute scenario strategies (returns AgentDecision objects)
  if (isPlainObject(msg) && msg.type === 'execute_scenario_strategies' && Number.isInteger(msg.requestId)) {
    try {
      if (!Array.isArray(msg.strategies) || !msg.strategies.every(s => typeof s === 'string')) {
        throw new Error('strategies must be an array of strings');
      }
      if (!Array.isArray(msg.observations) || msg.observations.length !== msg.strategies.length) {
        throw new Error('observations must be an array matching strategies length');
      }
      if (!isPlainObject(msg.scenario) || typeof msg.scenario.agentCount !== 'number') {
        throw new Error('scenario must be a valid object with agentCount');
      }
      const decisions = executeScenarioStrategies(msg.strategies, msg.observations, msg.scenario);
      safeProcess.send?.({
        type: 'scenario_strategies_result',
        requestId: msg.requestId,
        decisions,
      });
    } catch (err) {
      const strategyCount = Array.isArray(msg.strategies) ? msg.strategies.length : 0;
      safeProcess.send?.({
        type: 'scenario_strategies_result',
        requestId: msg.requestId,
        decisions: Array.from({ length: strategyCount }, (_, i) => ({
          error: err?.message || String(err),
          agentIndex: i,
        })),
      });
    }
    return;
  }

  if (isPlainObject(msg) && msg.type === 'ping') {
    safeProcess.send?.({ type: 'pong' });
  }
});

safeProcess.send?.({ type: 'ready' });
