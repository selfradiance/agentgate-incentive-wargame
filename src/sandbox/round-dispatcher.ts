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

function isErrorExtraction(value: unknown): value is { error: string; agentIndex: number } {
  return !!value
    && typeof value === 'object'
    && typeof (value as { error?: unknown }).error === 'string'
    && Number.isInteger((value as { agentIndex?: unknown }).agentIndex);
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
    && (msg as { extractions: unknown[] }).extractions.every(value =>
      typeof value === 'number' || isErrorExtraction(value)
    );
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

  kill(): void {
    if (this.child) {
      this.child.kill('SIGKILL');
      this.child = null;
      this.ready = false;
    }
  }
}
