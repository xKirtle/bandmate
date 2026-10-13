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
    // Clip's Fades; Bandmate's mark; calibration's metronome. An
    // icon comes from Lucide instead
    // (docs/design.md, Icons).
    const drawings = [
      'lib/AudioPlayer.svelte',
      'lib/BrandMark.svelte',
      'lib/ChordDiagram.svelte',
      'lib/Metronome.svelte',
      'lib/Timeline.svelte',
    ];
    const drawn = files.filter(({ code }) => /<svg[\s>]/.test(code)).map(({ path }) => path);
    expect(drawn.sort()).toEqual(drawings);
  });

  describe("match docs/design.md's icon table", () => {
    const imported = new Set(
      files.flatMap(({ code }) =>
        [...code.matchAll(/\b(?:from|import\s*\()\s*['"]@lucide\/svelte\/icons\/([a-z0-9-]+)(?:\.js)?['"]/g)].map(
          (m) => m[1],
        ),
      ),
    );

    // The backticked names in each row's Icon column, under "### Icons".
    const design = readFileSync(join(src, '../../docs/design.md'), 'utf8');
    const section = design.match(/^### Icons\n([\s\S]*?)(?=^#{1,3} |(?![\s\S]))/m)?.[1] ?? '';
    const table = section.match(/^\|\s*Icon\s*\|\s*For\s*\|\n\|[-\s|]+\|\n((?:\|.*\|\n?)*)/m)?.[1];
    const rows = (table ?? '')
      .trim()
      .split('\n')
      .map((row) => [...(row.split('|')[1] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    const listed = rows.flat();
    // Without the table, say so, rather than call every icon missing.
    const readTable = () =>
      expect(listed.length, "couldn't read the icon table under docs/design.md's ### Icons").toBeGreaterThan(0);

    it('gives every imported icon a row', () => {
      readTable();
      const missing = [...imported].filter((name) => !listed.includes(name)).sort();
      expect(missing, 'imported, so each needs a row in the icon table').toEqual([]);
    });

    it('lists only icons that are imported', () => {
      readTable();
      const unused = listed.filter((name) => !imported.has(name)).sort();
      expect(unused, 'imported nowhere, so remove each from the icon table').toEqual([]);
    });

    it('puts each icon in one row', () => {
      readTable();
      const twice = [...new Set(listed.filter((name, i) => listed.indexOf(name) !== i))].sort();
      expect(twice, 'in more than one row of the icon table: one icon, one meaning').toEqual([]);
    });
  });
});
