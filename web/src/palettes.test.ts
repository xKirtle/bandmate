import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Checks the Palettes in palettes.css against the contrast floor in
// docs/design.md, and the Track Colours against what it holds them to, in both
// themes of every Palette.

const PALETTES = ['terracotta', 'ink', 'olive'] as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
type Tokens = Record<string, string>;

const TRACK_COLOURS = [1, 2, 3, 4, 5, 6].map((n) => `--track-colour-${n}`);
// What docs/design.md holds a Track Colour to, in OKLab terms: how far its
// hue is from the accent's, how different it looks from the accent, and the
// most chroma it may have.
const TRACK_COLOUR_HUE_GAP = 50;
const TRACK_COLOUR_DIFFERENCE = 0.1;
const TRACK_COLOUR_CHROMA = 0.1;

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
  ['--shelved-fg', '--shelved-bg', 4.5, 'The shelved Status badge'],
  ['--accent', '--surface-2', 3, 'Accent controls and the selected outline on raised areas'],
  ['--text-muted', '--surface-2', 3, 'Icons on controls'],
  ['--piano-white', '--piano-black', 3, "A piano's white keys beside its black keys"],
  ['--text', '--bg', 7, 'Lines in Read mode'],
  ['--text', '--surface-1', 7, 'Lines in Read mode, on the current Line'],
  ...TRACK_COLOURS.map((token): [string, string, number, string] => [
    token,
    '--surface-1',
    3,
    "A Clip's border and waveform",
  ]),
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

/** A colour's red, green and blue, from 0 to 255. */
function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** A colour's red, green and blue as light, from 0 to 1. */
function linear(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return [r, g, b];
}

function luminance(hex: string): number {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG 2 contrast ratio of two colours, from 1 to 21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in srgb, a percent%, b)`. */
function mix(a: string, percent: number, b: string): string {
  const [from, to] = [channels(a), channels(b)];
  const mixed = from.map((v, i) => Math.round((v * percent + to[i] * (100 - percent)) / 100));
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A colour in OKLab, where the distance between two colours follows how
    different they look: [lightness, green to red, blue to yellow]. */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = linear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** How different two colours look. */
function difference(a: string, b: string): number {
  const [from, to] = [oklab(a), oklab(b)];
  return Math.hypot(from[0] - to[0], from[1] - to[1], from[2] - to[2]);
}

/** How saturated a colour looks, however light or dark it is: OKLCH's chroma. */
function chroma(hex: string): number {
  const [, a, b] = oklab(hex);
  return Math.hypot(a, b);
}

/** How far apart two colours' hues are round the wheel, from 0 to 180 degrees. */
function hueGap(x: string, y: string): number {
  const hue = (hex: string) => {
    const [, a, b] = oklab(hex);
    return (Math.atan2(b, a) * 180) / Math.PI;
  };
  const gap = Math.abs(hue(x) - hue(y));
  return gap > 180 ? 360 - gap : gap;
}

/** How much of the accent tints a selected Clip's background, from Timeline.svelte. */
function selectedClipTint(): number {
  const timeline = readFileSync(new URL('./lib/Timeline.svelte', import.meta.url), 'utf8');
  const tint = timeline.match(
    /\.clip\.selected \{[^}]*color-mix\(in srgb, var\(--accent\) (\d+)%, var\(--surface-1\)\)/,
  );
  expect(tint, "a selected Clip's background is a tint of the accent on --surface-1").not.toBeNull();
  return Number(tint![1]);
}

describe('contrast', () => {
  it('runs from 1 to 21', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21);
    expect(contrast('#777777', '#777777')).toBe(1);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});

describe('mix', () => {
  it('blends two colours by their sRGB channels', () => {
    expect(mix('#000000', 25, '#ffffff')).toBe('#bfbfbf');
    expect(mix('#ff0000', 100, '#0000ff')).toBe('#ff0000');
    expect(mix('#ff0000', 0, '#0000ff')).toBe('#0000ff');
  });
});

describe('oklab', () => {
  it('matches the published values for white and pure red', () => {
    const [whiteL, whiteA, whiteB] = oklab('#ffffff');
    expect(whiteL).toBeCloseTo(1, 3);
    expect(whiteA).toBeCloseTo(0, 3);
    expect(whiteB).toBeCloseTo(0, 3);
    const [redL, redA, redB] = oklab('#ff0000');
    expect(redL).toBeCloseTo(0.628, 3);
    expect(redA).toBeCloseTo(0.225, 3);
    expect(redB).toBeCloseTo(0.126, 3);
  });

  it('gives a grey no chroma, and hues wrap round the wheel', () => {
    expect(chroma('#777777')).toBeCloseTo(0, 3);
    expect(hueGap('#ff0000', '#ff0000')).toBe(0);
    // Green-leaning teal and cyan sit either side of where hues wrap.
    expect(hueGap('#00ff80', '#00ffff')).toBeLessThan(60);
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

      const shades = () => TRACK_COLOURS.map((token) => palettes[name][theme].tokens[token]);

      it(`${name} ${theme}: has only the six Track Colours`, () => {
        const named = Object.keys(palettes[name][theme].tokens).filter((token) => token.startsWith('--track-colour'));
        expect(named.sort()).toEqual(TRACK_COLOURS);
      });

      it(`${name} ${theme}: every Track Colour is at least 3:1 on a selected Clip's background`, () => {
        const colours = palettes[name][theme].tokens;
        const background = mix(colours['--accent'], selectedClipTint(), colours['--surface-1']);
        for (const shade of shades()) expect(contrast(shade, background), shade).toBeGreaterThanOrEqual(3);
      });

      it(`${name} ${theme}: no Track Colour is close to the accent, so an unselected Clip can't look selected`, () => {
        const accent = palettes[name][theme].tokens['--accent'];
        for (const shade of shades()) {
          expect(hueGap(shade, accent), shade).toBeGreaterThanOrEqual(TRACK_COLOUR_HUE_GAP);
          expect(difference(shade, accent), shade).toBeGreaterThanOrEqual(TRACK_COLOUR_DIFFERENCE);
        }
      });

      it(`${name} ${theme}: the Track Colours stay muted`, () => {
        for (const shade of shades()) expect(chroma(shade), shade).toBeLessThanOrEqual(TRACK_COLOUR_CHROMA);
      });

      it(`${name} ${theme}: the first two Track Colours are the most distinct pair`, () => {
        const set = shades();
        const others = set.flatMap((a, i) => set.slice(i + 1).map((b) => [a, b])).slice(1);
        const first = difference(set[0], set[1]);
        for (const [a, b] of others) expect(first, `${a} and ${b}`).toBeGreaterThan(difference(a, b));
      });
    }
  }
});
