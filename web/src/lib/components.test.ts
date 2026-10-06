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

/** Some CSS without its `@media (hover: hover)` blocks. */
function withoutHoverOnly(css: string): string {
  const opening = /@media \(hover: hover\)\s*\{/g;
  let rest = '';
  let from = 0;
  for (const m of css.matchAll(opening)) {
    if (m.index < from) continue;
    rest += css.slice(from, m.index);
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    from = i;
  }
  return rest + css.slice(from);
}

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

  it("shows an icon button's hover box only to a pointer that can hover", () => {
    // A tap on a touch screen leaves :hover on what it tapped, so the box would stay.
    const css = readFileSync(join(src, 'app.css'), 'utf8');
    expect(css).toMatch(/\.icon:hover/);
    expect(withoutHoverOnly(css)).not.toMatch(/\.icon:hover/);
  });
});
