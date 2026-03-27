// Agent 006: Child Runner
// Runs inside a permission-restricted child process.
// Each strategy executes in a fresh vm context with string code generation disabled.

import { Script, createContext } from 'node:vm';

const STRATEGY_TIMEOUT_MS = 250;

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

function isExecuteRoundMessage(msg) {
  return isPlainObject(msg)
    && msg.type === 'execute_round'
    && Number.isInteger(msg.requestId)
    && Array.isArray(msg.strategies)
    && msg.strategies.every(strategy => typeof strategy === 'string')
    && isPlainObject(msg.state);
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

  if (isPlainObject(msg) && msg.type === 'ping') {
    safeProcess.send?.({ type: 'pong' });
  }
});

safeProcess.send?.({ type: 'ready' });
