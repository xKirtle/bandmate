import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAppearance,
  paletteKey,
  readPalette,
  readThemeChoice,
  shownTheme,
  storePalette,
  storeThemeChoice,
  themeKey,
} from './appearance';

/** A Storage holding some values, or one that throws like a blocked one. */
function storage(values: Record<string, string> = {}, blocked = false): Storage {
  const fail = () => {
    throw new DOMException('Blocked', 'SecurityError');
  };
  return {
    getItem: (key: string) => (blocked ? fail() : (values[key] ?? null)),
    setItem: (key: string, value: string) => (blocked ? fail() : void (values[key] = value)),
    removeItem: (key: string) => (blocked ? fail() : void delete values[key]),
  } as Storage;
}

describe('readPalette', () => {
  it('is Terracotta until another is picked on this device', () => {
    expect(readPalette(storage())).toBe('terracotta');
  });

  it('is Terracotta without storage, or when it is blocked', () => {
    expect(readPalette(undefined)).toBe('terracotta');
    expect(readPalette(storage({}, true))).toBe('terracotta');
  });

  it('is the Palette picked', () => {
    expect(readPalette(storage({ [paletteKey]: 'ink' }))).toBe('ink');
    expect(readPalette(storage({ [paletteKey]: 'olive' }))).toBe('olive');
  });

  it('is Terracotta when what is kept is no Palette', () => {
    expect(readPalette(storage({ [paletteKey]: 'neon' }))).toBe('terracotta');
  });
});

describe('storePalette', () => {
  it('keeps the Palette picked', () => {
    const s = storage();
    storePalette(s, 'olive');
    expect(readPalette(s)).toBe('olive');
  });

  it('forgets the choice once Terracotta is picked again', () => {
    const values = { [paletteKey]: 'ink' };
    storePalette(storage(values), 'terracotta');
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storePalette(undefined, 'ink')).not.toThrow();
    expect(() => storePalette(storage({}, true), 'ink')).not.toThrow();
  });
});

describe('readThemeChoice', () => {
  it('follows the system until Light or Dark is picked on this device', () => {
    expect(readThemeChoice(storage())).toBe('system');
  });

  it('follows the system without storage, or when it is blocked', () => {
    expect(readThemeChoice(undefined)).toBe('system');
    expect(readThemeChoice(storage({}, true))).toBe('system');
  });

  it('is Light or Dark once picked', () => {
    expect(readThemeChoice(storage({ [themeKey]: 'light' }))).toBe('light');
    expect(readThemeChoice(storage({ [themeKey]: 'dark' }))).toBe('dark');
  });

  it('follows the system when what is kept is neither', () => {
    expect(readThemeChoice(storage({ [themeKey]: 'sepia' }))).toBe('system');
  });
});

describe('storeThemeChoice', () => {
  it('keeps Light or Dark', () => {
    const s = storage();
    storeThemeChoice(s, 'dark');
    expect(readThemeChoice(s)).toBe('dark');
  });

  it('forgets the choice once System is picked again', () => {
    const values = { [themeKey]: 'light' };
    storeThemeChoice(storage(values), 'system');
    expect(values).toEqual({});
  });

  it('does nothing without storage, or when it is blocked', () => {
    expect(() => storeThemeChoice(undefined, 'dark')).not.toThrow();
    expect(() => storeThemeChoice(storage({}, true), 'dark')).not.toThrow();
  });
});

describe('shownTheme', () => {
  it("is the system's under System", () => {
    expect(shownTheme('system', true)).toBe('dark');
    expect(shownTheme('system', false)).toBe('light');
  });

  it('is Light or Dark, whatever the system, once picked', () => {
    expect(shownTheme('light', true)).toBe('light');
    expect(shownTheme('dark', false)).toBe('dark');
  });
});

/** The root element's dataset, the only part of it the app's look is set on. */
const root = (dataset: Record<string, string> = {}) => ({ dataset }) as HTMLElement;

describe('applyAppearance', () => {
  it('marks the root with the Palette and light or dark', () => {
    const el = root();
    applyAppearance(el, 'ink', 'dark');
    expect(el.dataset).toEqual({ palette: 'ink', theme: 'dark' });
  });

  it('leaves Terracotta unmarked, as the default', () => {
    const el = root({ palette: 'olive', theme: 'dark' });
    applyAppearance(el, 'terracotta', 'light');
    expect(el.dataset).toEqual({ theme: 'light' });
  });
});

describe("index.html's first paint", () => {
  // The script that sets the Palette and light or dark before the page first
  // paints, run as the browser would, against what this device keeps.
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';

  function firstPaint(kept: Record<string, string> | 'blocked', systemDark: boolean) {
    const el = root();
    const store = kept === 'blocked' ? storage({}, true) : storage(kept);
    const matchMedia = (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark });
    new Function('document', 'localStorage', 'matchMedia', script)({ documentElement: el }, store, matchMedia);
    return el.dataset;
  }

  it('runs in the head, before the page is drawn', () => {
    expect(script).not.toBe('');
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</head>'));
  });

  it('is Terracotta, following the system, when nothing is kept', () => {
    expect(firstPaint({}, false)).toEqual({ theme: 'light' });
    expect(firstPaint({}, true)).toEqual({ theme: 'dark' });
  });

  it('is the Palette and Light or Dark kept on this device', () => {
    expect(firstPaint({ [paletteKey]: 'ink', [themeKey]: 'light' }, true)).toEqual({ palette: 'ink', theme: 'light' });
    expect(firstPaint({ [paletteKey]: 'olive', [themeKey]: 'dark' }, false)).toEqual({
      palette: 'olive',
      theme: 'dark',
    });
  });

  it('falls back like the app when what is kept is no choice, or storage is blocked', () => {
    expect(firstPaint({ [paletteKey]: 'neon', [themeKey]: 'sepia' }, true)).toEqual({ theme: 'dark' });
    expect(firstPaint('blocked', false)).toEqual({ theme: 'light' });
  });
});
