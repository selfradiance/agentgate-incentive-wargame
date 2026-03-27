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

export class RoundDispatcher {
  private child: ChildProcess | null = null;
  private ready = false;

  async spawn(): Promise<void> {
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

      // Timeout for initial ready signal — must be cleared on success/failure
      // to prevent stale timeouts from killing subsequently spawned children
      const readyTimeout = setTimeout(() => {
        if (!this.ready) {
          this.child?.kill('SIGKILL');
          reject(new Error('Child process did not become ready within timeout'));
        }
      }, 5000);

      const onReady = (msg: unknown) => {
        if (msg && typeof msg === 'object' && (msg as Record<string, unknown>).type === 'ready') {
          this.ready = true;
          clearTimeout(readyTimeout);
          this.child!.off('message', onReady);
          resolve();
        }
      };

      this.child.on('message', onReady);

      this.child.on('error', (err) => {
        if (!this.ready) {
          clearTimeout(readyTimeout);
          reject(err);
        }
      });

      this.child.on('exit', () => {
        this.ready = false;
      });
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
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
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
        if (
          settled ||
          !msg ||
          typeof msg !== 'object' ||
          (msg as Record<string, unknown>).type !== 'round_result'
        ) return;

        settled = true;
        clearTimeout(timeout);
        this.child?.off('message', onMessage);
        this.child?.off('exit', onExit);

        resolve({
          extractions: (msg as { extractions: unknown[] }).extractions as RoundDispatchResult['extractions'],
          timedOut: false,
          childCrashed: false,
        });
      };

      const onExit = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
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

      this.child!.send({
        type: 'execute_round',
        strategies,
        state,
      });
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
