// Agent 006: Round Dispatcher
// Parent-side IPC manager. Spawns child process, dispatches round execution,
// enforces 3-second timeout with SIGKILL + respawn.

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CHILD_RUNNER_PATH = path.join(__dirname, 'child-runner.js');

const ROUND_TIMEOUT_MS = 3000;

export interface RoundDispatchResult {
  extractions: (number | { error: string; agentIndex: number })[];
  timedOut: boolean;
  childCrashed: boolean;
}

function isErrorExtraction(
  value: unknown,
  expectedAgentIndex: number,
): value is { error: string; agentIndex: number } {
  return !!value
    && typeof value === 'object'
    && typeof (value as { error?: unknown }).error === 'string'
    && (value as { agentIndex?: unknown }).agentIndex === expectedAgentIndex;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isValidRoundResultMessage(
  msg: unknown,
  requestId: number,
  expectedLength: number,
): msg is { type: 'round_result'; requestId: number; extractions: RoundDispatchResult['extractions'] } {
  return !!msg
    && typeof msg === 'object'
    && (msg as Record<string, unknown>).type === 'round_result'
    && (msg as Record<string, unknown>).requestId === requestId
    && Array.isArray((msg as Record<string, unknown>).extractions)
    && (msg as { extractions: unknown[] }).extractions.length === expectedLength
    && (msg as { extractions: unknown[] }).extractions.every((value, index) =>
      (typeof value === 'number' && Number.isFinite(value)) || isErrorExtraction(value, index)
    );
}

function isValidScenarioDecision(
  value: unknown,
  expectedAgentIndex: number,
): value is Record<string, unknown> | { error: string; agentIndex: number } {
  return isErrorExtraction(value, expectedAgentIndex) || isPlainObject(value);
}

function isValidScenarioStrategiesResultMessage(
  msg: unknown,
  requestId: number,
  expectedLength: number,
): msg is { type: 'scenario_strategies_result'; requestId: number; decisions: Record<string, unknown>[] } {
  return isPlainObject(msg)
    && msg.type === 'scenario_strategies_result'
    && msg.requestId === requestId
    && Array.isArray(msg.decisions)
    && msg.decisions.length === expectedLength
    && msg.decisions.every((value, index) => isValidScenarioDecision(value, index));
}

export class RoundDispatcher {
  private child: ChildProcess | null = null;
  private ready = false;
  private nextRequestId = 1;

  async spawn(): Promise<void> {
    this.kill();
    await this._spawnChild();
  }

  private _spawnChild(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ready = false;

      this.child = fork(CHILD_RUNNER_PATH, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        execArgv: [
          '--permission',
          `--allow-fs-read=${CHILD_RUNNER_PATH}`,
        ],
      });
      const child = this.child;

      child.on('exit', () => {
        if (this.child === child) {
          this.child = null;
          this.ready = false;
        }
      });

      let settled = false;

      const cleanup = () => {
        clearTimeout(readyTimeout);
        child.off('message', onReady);
        child.off('error', onError);
        child.off('exit', onExitBeforeReady);
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        child.kill('SIGKILL');
        this.child = null;
        this.ready = false;
        reject(err);
      };

      const readyTimeout = setTimeout(() => {
        if (!this.ready) {
          fail(new Error('Child process did not become ready within timeout'));
        }
      }, 5000);

      const onReady = (msg: unknown) => {
        if (msg && typeof msg === 'object' && (msg as Record<string, unknown>).type === 'ready') {
          if (settled) return;
          settled = true;
          this.ready = true;
          cleanup();
          resolve();
        }
      };

      const onError = (err: Error) => {
        if (!this.ready) {
          fail(err);
        }
      };

      const onExitBeforeReady = () => {
        if (!this.ready) {
          fail(new Error('Child process exited before signaling ready'));
          return;
        }
        this.ready = false;
      };

      child.on('message', onReady);
      child.on('error', onError);
      child.on('exit', onExitBeforeReady);
    });
  }

  async executeRound(
    strategies: string[],
    state: Record<string, unknown>,
  ): Promise<RoundDispatchResult> {
    if (!this.child || !this.ready) {
      await this._spawnChild();
    }

    return new Promise((resolve) => {
      const requestId = this.nextRequestId++;
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        this.child?.off('message', onMessage);
        this.child?.off('exit', onExit);
      };

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          this.child?.kill('SIGKILL');
          this.child = null;
          this.ready = false;
          resolve({
            extractions: strategies.map(() => 0),
            timedOut: true,
            childCrashed: false,
          });
        }
      }, ROUND_TIMEOUT_MS);

      const onMessage = (msg: unknown) => {
        if (settled) return;
        if (!msg || typeof msg !== 'object') return;

        const msgType = (msg as Record<string, unknown>).type;
        if (msgType !== 'round_result') return;

        if (!isValidRoundResultMessage(msg, requestId, strategies.length)) {
          settled = true;
          cleanup();
          this.child?.kill('SIGKILL');
          this.child = null;
          this.ready = false;
          resolve({
            extractions: strategies.map(() => 0),
            timedOut: false,
            childCrashed: true,
          });
          return;
        }

        settled = true;
        cleanup();

        resolve({
          extractions: msg.extractions,
          timedOut: false,
          childCrashed: false,
        });
      };

      const onExit = () => {
        if (!settled) {
          settled = true;
          cleanup();
          this.child = null;
          this.ready = false;
          resolve({
            extractions: strategies.map(() => 0),
            timedOut: false,
            childCrashed: true,
          });
        }
      };

      this.child!.on('message', onMessage);
      this.child!.on('exit', onExit);

      try {
        this.child!.send({
          type: 'execute_round',
          requestId,
          strategies,
          state,
        });
      } catch {
        settled = true;
        cleanup();
        this.child = null;
        this.ready = false;
        resolve({
          extractions: strategies.map(() => 0),
          timedOut: false,
          childCrashed: true,
        });
      }
    });
  }

  // --- v0.3.0: Economy Module Methods ---

  async loadEconomy(code: string): Promise<{ success: boolean; error?: string }> {
    if (!this.child || !this.ready) {
      await this._spawnChild();
    }

    return new Promise((resolve) => {
      const requestId = this.nextRequestId++;
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        this.child?.off('message', onMessage);
        this.child?.off('exit', onExit);
      };

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          this.child?.kill('SIGKILL');
          this.child = null;
          this.ready = false;
          resolve({ success: false, error: 'Economy load timed out' });
        }
      }, ROUND_TIMEOUT_MS);

      const onMessage = (msg: unknown) => {
        if (settled) return;
        if (!msg || typeof msg !== 'object') return;
        const m = msg as Record<string, unknown>;
        if (m.type !== 'economy_loaded' || m.requestId !== requestId) return;

        if (typeof m.success !== 'boolean') {
          settled = true;
          cleanup();
          resolve({ success: false, error: 'Malformed economy_loaded response: success is not boolean' });
          return;
        }
        if (m.error !== undefined && typeof m.error !== 'string') {
          settled = true;
          cleanup();
          resolve({ success: false, error: 'Malformed economy_loaded response: error is not string' });
          return;
        }

        settled = true;
        cleanup();
        resolve({ success: m.success, error: m.error as string | undefined });
      };

      const onExit = () => {
        if (!settled) {
          settled = true;
          cleanup();
          this.child = null;
          this.ready = false;
          resolve({ success: false, error: 'Child process exited during economy load' });
        }
      };

      this.child!.on('message', onMessage);
      this.child!.on('exit', onExit);

      try {
        this.child!.send({ type: 'load_economy', requestId, code });
      } catch {
        settled = true;
        cleanup();
        this.child = null;
        this.ready = false;
        resolve({ success: false, error: 'Failed to send economy load message' });
      }
    });
  }

  async callEconomyFunction(fnName: string, args: unknown[]): Promise<{ success: boolean; result?: unknown; error?: string }> {
    if (!this.child || !this.ready) {
      await this._spawnChild();
    }

    return new Promise((resolve) => {
      const requestId = this.nextRequestId++;
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        this.child?.off('message', onMessage);
        this.child?.off('exit', onExit);
      };

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          this.child?.kill('SIGKILL');
          this.child = null;
          this.ready = false;
          resolve({ success: false, error: `Economy call ${fnName} timed out` });
        }
      }, ROUND_TIMEOUT_MS);

      const onMessage = (msg: unknown) => {
        if (settled) return;
        if (!msg || typeof msg !== 'object') return;
        const m = msg as Record<string, unknown>;
        if (m.type !== 'economy_call_result' || m.requestId !== requestId) return;

        if (typeof m.success !== 'boolean') {
          settled = true;
          cleanup();
          resolve({ success: false, error: 'Malformed economy_call_result: success is not boolean' });
          return;
        }
        if (m.error !== undefined && typeof m.error !== 'string') {
          settled = true;
          cleanup();
          resolve({ success: false, error: 'Malformed economy_call_result: error is not string' });
          return;
        }

        settled = true;
        cleanup();
        resolve({
          success: m.success,
          result: m.result,
          error: m.error as string | undefined,
        });
      };

      const onExit = () => {
        if (!settled) {
          settled = true;
          cleanup();
          this.child = null;
          this.ready = false;
          resolve({ success: false, error: 'Child process exited during economy call' });
        }
      };

      this.child!.on('message', onMessage);
      this.child!.on('exit', onExit);

      try {
        this.child!.send({ type: 'economy_call', requestId, fnName, args });
      } catch {
        settled = true;
        cleanup();
        this.child = null;
        this.ready = false;
        resolve({ success: false, error: `Failed to send economy call ${fnName}` });
      }
    });
  }

  async executeScenarioStrategies(
    strategies: string[],
    observations: Record<string, unknown>[],
    scenario: Record<string, unknown>,
  ): Promise<{ decisions: (Record<string, unknown> | { error: string; agentIndex: number })[] }> {
    if (!this.child || !this.ready) {
      await this._spawnChild();
    }

    return new Promise((resolve) => {
      const requestId = this.nextRequestId++;
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        this.child?.off('message', onMessage);
        this.child?.off('exit', onExit);
      };

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          this.child?.kill('SIGKILL');
          this.child = null;
          this.ready = false;
          resolve({
            decisions: strategies.map((_, i) => ({ error: 'Strategy execution timed out', agentIndex: i })),
          });
        }
      }, ROUND_TIMEOUT_MS);

      const onMessage = (msg: unknown) => {
        if (settled) return;
        if (!msg || typeof msg !== 'object') return;
        if (!isValidScenarioStrategiesResultMessage(msg, requestId, strategies.length)) {
          const m = msg as Record<string, unknown>;
          if (m.type !== 'scenario_strategies_result' || m.requestId !== requestId) {
            return;
          }

          settled = true;
          cleanup();
          this.child?.kill('SIGKILL');
          this.child = null;
          this.ready = false;
          resolve({
            decisions: strategies.map((_, i) => ({ error: 'Malformed strategy execution response', agentIndex: i })),
          });
          return;
        }

        settled = true;
        cleanup();
        resolve({ decisions: msg.decisions });
      };

      const onExit = () => {
        if (!settled) {
          settled = true;
          cleanup();
          this.child = null;
          this.ready = false;
          resolve({
            decisions: strategies.map((_, i) => ({ error: 'Child crashed during strategy execution', agentIndex: i })),
          });
        }
      };

      this.child!.on('message', onMessage);
      this.child!.on('exit', onExit);

      try {
        this.child!.send({ type: 'execute_scenario_strategies', requestId, strategies, observations, scenario });
      } catch {
        settled = true;
        cleanup();
        this.child = null;
        this.ready = false;
        resolve({
          decisions: strategies.map((_, i) => ({ error: 'Failed to send strategy execution message', agentIndex: i })),
        });
      }
    });
  }

  kill(): void {
    if (this.child) {
      this.child.kill('SIGKILL');
      this.child = null;
      this.ready = false;
    }
  }
}
