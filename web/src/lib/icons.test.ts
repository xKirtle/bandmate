import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every source file of the app, but the tests.
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const src = join(import.meta.dirname, '..');
const files = sources(src).map((path) => ({ path: path.slice(src.length + 1), text: readFileSync(path, 'utf8') }));

describe('icons', () => {
  it('imports each Lucide icon on its own, so only the icons used are bundled', () => {
    const wholeSet = files.flatMap(({ path, text }) =>
      [...text.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+'@lucide\/svelte(\/icons)?';/gm)].map(
        (m) => `${path}: ${m[0].trim()}`,
      ),
    );
    expect(wholeSet).toEqual([]);
  });

  it('draws no icon by hand: the only inline SVGs are drawings, a Chord diagram and waveforms', () => {
    const drawn = files.filter(({ text }) => text.includes('<svg')).map(({ path }) => path);
    expect(drawn.sort()).toEqual(['lib/AudioPlayer.svelte', 'lib/ChordDiagram.svelte', 'lib/Timeline.svelte']);
  });
});
