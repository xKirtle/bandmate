import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base, expect } from '@playwright/test';
import { Bandmate } from './bandmate';

// The suite's test, with a Bandmate per worker. Import { test, expect } from
// here, not from @playwright/test.

/** A Bandmate server a worker started, on a port and data directory of its own. */
export interface Server {
  /** Where it's served, e.g. http://127.0.0.1:41234. */
  url: string;
  /** Its data directory: the database and the audio files. */
  dataDir: string;
}

interface TestFixtures {
  /**
   * The worker's Bandmate, emptied before every test starts, through its HTTP
   * API: make what the test needs with it, and read back what it holds.
   */
  bandmate: Bandmate;
}

interface WorkerFixtures {
  server: Server;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  server: [
    async ({}, use) => {
      const bin = process.env.BANDMATE_BIN;
      if (!bin) throw new Error('BANDMATE_BIN is unset: run the suite with `npm test`, whose setup builds Bandmate.');
      const dataDir = mkdtempSync(join(tmpdir(), 'bandmate-e2e-data-'));
      const port = await freePort();
      const url = `http://127.0.0.1:${port}`;
      const proc = spawn(bin, [], {
        env: {
          ...process.env,
          BANDMATE_ADDR: `127.0.0.1:${port}`,
          BANDMATE_DATA_DIR: dataDir,
          // Never asks GitHub for releases.
          BANDMATE_UPDATE_CHECK: 'off',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      proc.stdout.on('data', (chunk) => (output += chunk));
      proc.stderr.on('data', (chunk) => (output += chunk));
      try {
        await healthy(url, proc, () => output);
        await use({ url, dataDir });
      } finally {
        await stop(proc);
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],

  baseURL: async ({ server }, use) => use(server.url),

  // Auto, so every test starts with Bandmate empty, whether it asks for this
  // fixture or not.
  bandmate: [
    async ({ playwright, server }, use) => {
      const api = await playwright.request.newContext({ baseURL: server.url });
      const bandmate = new Bandmate(api);
      await bandmate.wipe();
      await use(bandmate);
      await api.dispose();
    },
    { auto: true },
  ],
});

export { expect };

/** A port nothing is listening on now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No port')),
      );
    });
  });
}

/** Waits for the server to answer its health check, failing with its output if it exits or takes too long. */
async function healthy(url: string, proc: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (exited(proc)) throw new Error(`Bandmate exited (${proc.exitCode ?? proc.signalCode}):\n${output()}`);
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  proc.kill();
  throw new Error(`Bandmate didn't become healthy at ${url}:\n${output()}`);
}

/** Stops the server, waiting for it to exit. */
function stop(proc: ChildProcess): Promise<void> {
  if (exited(proc)) return Promise.resolve();
  return new Promise((resolve) => {
    proc.once('exit', () => resolve());
    proc.kill();
  });
}

/** Whether the process has exited, on its own or killed by a signal. */
function exited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}
