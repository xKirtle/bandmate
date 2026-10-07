import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');

/**
 * Builds the Bandmate binary every worker starts, embedding the web app as
 * last built, and tells the workers where it is in BANDMATE_BIN. Answers
 * with the teardown that removes it.
 */
export default function globalSetup() {
  if (!existsSync(join(repo, 'web', 'dist', 'index.html'))) {
    throw new Error("The web app hasn't been built: run `npm test`, which builds it, or `npm run build` in web/.");
  }
  const dir = mkdtempSync(join(tmpdir(), 'bandmate-e2e-bin-'));
  const bin = join(dir, process.platform === 'win32' ? 'bandmate.exe' : 'bandmate');
  execFileSync('go', ['build', '-o', bin, './cmd/bandmate'], { cwd: repo, stdio: 'inherit' });
  process.env.BANDMATE_BIN = bin;
  return () => rmSync(dir, { recursive: true, force: true });
}
