import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The recurring components are written once (docs/design.md, Components), so
// a screen reaches for the shared one rather than drawing its own.

// Every component of the app, without its markup's comments.
function svelteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

const src = join(import.meta.dirname, '..');
const files = svelteFiles(src).map((path) => ({
  path: path.slice(src.length + 1),
  code: readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, ''),
}));
const filesMatching = (pattern: RegExp) =>
  files
    .filter(({ code }) => pattern.test(code))
    .map(({ path }) => path)
    .sort();

describe('components', () => {
  it('opens every modal dialog as a Dialog', () => {
    expect(filesMatching(/<dialog[\s>]/)).toEqual(['lib/Dialog.svelte']);
  });

  it("turns every fold's chevron with FoldChevron", () => {
    // A fold is a <details>; its summary's chevron is FoldChevron's.
    const folds = filesMatching(/<summary[\s>]/);
    expect(folds.length).toBeGreaterThan(0);
    const ownChevron = folds.filter((path) =>
      /icons\/chevron-right['"]/.test(files.find((f) => f.path === path)!.code),
    );
    expect(ownChevron).toEqual([]);
  });

  it("draws every tab with app.css's .tabs, styling none of its own", () => {
    // A tab is styled through [role='tab'] in a component's own styles.
    expect(filesMatching(/\[role=['"]tab['"]\]/)).toEqual([]);
  });
});
