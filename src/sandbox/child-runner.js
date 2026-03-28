// Agent 006: Child Runner
// Runs inside a permission-restricted child process.
// Strategy VM: each strategy executes in a fresh vm context with string code generation disabled.
// Economy VM: generated economy modules run in a persistent vm context with same restrictions.
// v0.3.0: Two VM contexts — one for economy, one for strategies.

import { Script, createContext } from 'node:vm';

const STRATEGY_TIMEOUT_MS = 250;
const ECONOMY_TIMEOUT_MS = 500;

const safeProcess = {
  on: process.on.bind(process),
  send: process.send ? process.send.bind(process) : null,
};

for (const name of ['process', 'fetch', 'XMLHttpRequest', 'WebSocket']) {
  try {
    globalThis[name] = undefined;
  } catch {
    // Ignore readonly globals.
  }
}

const SCRIPT_CACHE = new Map();

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

function getStrategyScript(strategyCode) {
  let cached = SCRIPT_CACHE.get(strategyCode);
  if (cached) return cached;

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
    { stateJson: JSON.stringify(agentState) },
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

      const result = executeStrategy(strategies[i], agentState);
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

let economyContext = null;
let economyFunctions = null;

function loadEconomyModule(code) {
  // Create a persistent VM context for the economy module
  const ctx = createContext(
    { exports: {} },
    { codeGeneration: { strings: false, wasm: false } },
  );

  // Compile and run the economy module code to populate exports
  // Replace 'export function X' with 'exports.X = function X' for VM compatibility
  const moduleCode = code.replace(/export\s+function\s+(\w+)/g, 'exports.$1 = function $1');
  // Also handle 'export const X = ...'
  const finalCode = moduleCode.replace(/export\s+const\s+(\w+)/g, 'exports.$1');

  const script = new Script(`'use strict';\n${finalCode}`);
  script.runInContext(ctx, { timeout: ECONOMY_TIMEOUT_MS });

  // Verify all 6 required exports exist
  const required = ['initState', 'tick', 'extractMetrics', 'checkInvariants', 'isCollapsed', 'getObservations'];
  const missing = required.filter(name => typeof ctx.exports[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(`Economy module missing exports: ${missing.join(', ')}`);
  }

  economyContext = ctx;
  economyFunctions = ctx.exports;
}

function callEconomyFunction(fnName, args) {
  if (!economyFunctions || !economyFunctions[fnName]) {
    throw new Error(`Economy function ${fnName} not loaded`);
  }

  // Serialize args through JSON to prevent context leakage
  const safeArgs = JSON.parse(JSON.stringify(args));

  const result = economyFunctions[fnName](...safeArgs);

  // Serialize result through JSON to prevent context leakage
  return JSON.parse(JSON.stringify(result));
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
      const result = executeStrategy(strategies[i], stateForAgent);

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
      const decisions = executeScenarioStrategies(msg.strategies, msg.observations, msg.scenario);
      safeProcess.send?.({
        type: 'scenario_strategies_result',
        requestId: msg.requestId,
        decisions,
      });
    } catch (err) {
      safeProcess.send?.({
        type: 'scenario_strategies_result',
        requestId: msg.requestId,
        decisions: msg.strategies.map((_, i) => ({ error: err?.message || String(err), agentIndex: i })),
      });
    }
    return;
  }

  if (isPlainObject(msg) && msg.type === 'ping') {
    safeProcess.send?.({ type: 'pong' });
  }
});

safeProcess.send?.({ type: 'ready' });
