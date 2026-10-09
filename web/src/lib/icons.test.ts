import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every source file of the app, but the tests, without its markup's
// comments or its whole-line script comments. Block comments stay: "/*"
// also starts a glob, as in accept="audio/*".
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}
const withoutComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');

const src = join(import.meta.dirname, '..');
const files = sources(src).map((path) => ({
  path: path.slice(src.length + 1),
  code: withoutComments(readFileSync(path, 'utf8')),
}));

describe('icons', () => {
  it('imports each Lucide icon on its own, so only the icons used are bundled', () => {
    // Anything but a type from the package's index, or its icons' index,
    // brings in every icon.
    const wholeSet = files.flatMap(({ path, code }) =>
      [
        ...code.matchAll(/\b(?:import|export)\s+(?!type\b)[^;]*?from\s*['"]@lucide\/svelte(?:\/icons)?['"]/g),
        ...code.matchAll(/\bimport\s*\(\s*['"]@lucide\/svelte(?:\/icons)?['"]/g),
      ].map((m) => `${path}: ${m[0]}`),
    );
    expect(wholeSet).toEqual([]);
  });

  it('draws no icon by hand: the only inline SVGs are drawings', () => {
    // A Chord diagram; the waveforms of a Master, a Beat and a Clip; a
    // Clip's Fades; Bandmate's mark; calibration's graph of its taps. An icon comes from Lucide instead
    // (docs/design.md, Icons).
    const drawings = [
      'lib/AudioPlayer.svelte',
      'lib/BrandMark.svelte',
      'lib/CalibrationTaps.svelte',
      'lib/ChordDiagram.svelte',
      'lib/Timeline.svelte',
    ];
    const drawn = files.filter(({ code }) => /<svg[\s>]/.test(code)).map(({ path }) => path);
    expect(drawn.sort()).toEqual(drawings);
  });
});
