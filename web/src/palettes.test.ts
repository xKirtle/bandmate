import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Checks the Palettes in palettes.css against the contrast floor in
// docs/design.md, in both themes of every Palette.

const PALETTES = ['terracotta', 'ink', 'olive'] as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
type Tokens = Record<string, string>;

// The pairs that carry meaning: [foreground, background, floor, what].
const PAIRS: [string, string, number, string][] = [
  ['--text', '--surface-2', 4.5, 'Text on controls'],
  ['--text-muted', '--bg', 4.5, 'Muted text, and Labels in Read mode'],
  ['--text-muted', '--surface-1', 4.5, 'Muted text on cards, and Labels in the current Section'],
  ['--accent', '--bg', 4.5, 'Accent text, links, and Chords in Read mode'],
  ['--accent', '--surface-1', 4.5, 'Accent text on cards, and Chords on the current Line'],
  ['--accent-text', '--accent', 4.5, 'Text on the primary button'],
  ['--danger', '--bg', 4.5, 'Errors'],
  ['--danger', '--surface-1', 4.5, 'Danger buttons'],
  ['--warning', '--bg', 4.5, 'Warnings'],
  ['--drafting-fg', '--drafting-bg', 4.5, 'The drafting Status badge'],
  ['--finished-fg', '--finished-bg', 4.5, 'The finished Status badge'],
  ['--accent', '--surface-2', 3, 'Accent controls and the selected outline on raised areas'],
  ['--text-muted', '--surface-2', 3, 'Icons on controls'],
  ['--text', '--bg', 7, 'Lines in Read mode'],
  ['--text', '--surface-1', 7, 'Lines in Read mode, on the current Line'],
];

/** A Palette's tokens in one theme, and the selectors that set them. */
interface PaletteRule {
  tokens: Tokens;
  selectors: string[];
}

/** Each Palette's colour tokens in each theme, read from palettes.css. A
    rule's selectors name its Palette with `[data-palette='…']`, Terracotta
    when none does, and its theme with `[data-theme='dark']`, light when none
    does. Only hex values count as a Palette's own: the shared tokens are
    built from them. */
function readPalettes(): Record<string, Record<Theme, PaletteRule>> {
  const css = readFileSync(new URL('./palettes.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css, 'palettes.css picks light or dark by attribute alone').not.toContain('@media');

  const byPalette: Record<string, Record<Theme, PaletteRule>> = {};
  for (const [, selectorList, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const tokens = [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].filter(([, , value]) => value.startsWith('#'));
    if (tokens.length === 0) continue;
    const selectors = selectorList.split(',').map((selector) => selector.trim());
    const named = selectors.map((selector) => ({
      palette: selector.match(/\[data-palette='([a-z]+)'\]/)?.[1] ?? 'terracotta',
      theme: (selector.includes("[data-theme='dark']") ? 'dark' : 'light') as Theme,
    }));
    const { palette, theme } = named[0];
    expect(named, `${selectorList.trim()} sets one Palette in one theme`).toEqual(named.map(() => named[0]));
    byPalette[palette] ??= { light: { tokens: {}, selectors: [] }, dark: { tokens: {}, selectors: [] } };
    byPalette[palette][theme].selectors.push(...selectors);
    for (const [, token, value] of tokens) {
      expect(value, `${palette} ${theme} ${token}`).toMatch(/^#[0-9a-f]{6}$/);
      byPalette[palette][theme].tokens[token] = value;
    }
  }
  return byPalette;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG 2 contrast ratio of two colours, from 1 to 21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('contrast', () => {
  it('runs from 1 to 21', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21);
    expect(contrast('#777777', '#777777')).toBe(1);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});

describe('Palettes', () => {
  const palettes = readPalettes();
  const tokens = Object.keys(palettes.terracotta.light.tokens).sort();

  it('are Terracotta, Ink and Olive', () => {
    expect(Object.keys(palettes).sort()).toEqual([...PALETTES].sort());
  });

  it('define every colour token in both themes', () => {
    expect(tokens).toContain('--accent');
    for (const name of PALETTES) {
      for (const theme of THEMES) {
        expect(Object.keys(palettes[name][theme].tokens).sort(), `${name} ${theme}`).toEqual(tokens);
      }
    }
  });

  it('show across the page, or on an element inside it, such as a swatch in Settings', () => {
    expect(palettes.terracotta.light.selectors, 'Terracotta, the default').toContain(':root');
    for (const name of PALETTES) {
      const own = `[data-palette='${name}']`;
      const page = name === 'terracotta' ? ":root[data-theme='dark']" : `:root[data-theme='dark']${own}`;
      expect(palettes[name].light.selectors, `${name} light`).toContain(own);
      expect(palettes[name].dark.selectors, `${name} dark`).toEqual(
        expect.arrayContaining([page, `:root[data-theme='dark'] ${own}`]),
      );
    }
  });

  for (const name of PALETTES) {
    for (const theme of THEMES) {
      it.each(PAIRS)(`${name} ${theme}: %s on %s is at least %d:1 (%s)`, (fg, bg, floor) => {
        const colours = palettes[name][theme].tokens;
        expect(contrast(colours[fg], colours[bg])).toBeGreaterThanOrEqual(floor);
      });
    }
  }
});
