import { afterEach, describe, expect, it, vi } from 'vitest';
import { paletteKey, themeKey, type Palette, type Theme } from './appearance';
import { DeviceAppearance } from './deviceAppearance.svelte';
import { storage } from './storageFake';

/** What the appearance was shown as: the Palette, and light or dark. */
type Shown = { palette: Palette; theme: Theme };

/** How a case starts: what this device's storage holds, and whether the system is dark. */
interface AppearanceCase {
  values?: Record<string, string>;
  systemDark?: boolean;
}

/**
 * The appearance on this device, over a stand-in Storage this device's other
 * tabs share and a stand-in answer to the system's light-or-dark, showing
 * itself into a list instead of onto the page.
 */
function appearanceOn({ values = {}, systemDark = false }: AppearanceCase = {}) {
  const system = Object.assign(new EventTarget(), { matches: systemDark });
  vi.stubGlobal('matchMedia', (query: string) => {
    if (query !== '(prefers-color-scheme: dark)') throw new Error(`Unexpected media query: ${query}`);
    return system;
  });
  const shown: Shown[] = [];
  const tabs = new EventTarget();
  const appearance = new DeviceAppearance(storage(values), tabs, (palette, theme) => shown.push({ palette, theme }));
  /** Another tab kept a choice, or cleared storage with a null key, as the browser tells this one. */
  const otherTab = (key: string | null) => tabs.dispatchEvent(Object.assign(new Event('storage'), { key }));
  /** The system turned light or dark, as the browser tells the page. */
  const systemTurned = (dark: boolean) => {
    system.matches = dark;
    system.dispatchEvent(new Event('change'));
  };
  return { appearance, shown, values, otherTab, systemTurned };
}

afterEach(() => vi.unstubAllGlobals());

describe('The appearance on this device, as the app starts', () => {
  it('is shown once, with both the Palette and light or dark kept here', () => {
    const { appearance, shown } = appearanceOn({ values: { [paletteKey]: 'ink', [themeKey]: 'dark' } });
    expect(appearance.palette).toBe('ink');
    expect(appearance.themeChoice).toBe('dark');
    expect(shown).toEqual([{ palette: 'ink', theme: 'dark' }]);
  });

  it('falls back to Terracotta and the system until either is picked here', () => {
    const { appearance, shown } = appearanceOn({ systemDark: true });
    expect(appearance.palette).toBe('terracotta');
    expect(appearance.themeChoice).toBe('system');
    expect(shown).toEqual([{ palette: 'terracotta', theme: 'dark' }]);
  });
});

describe('The appearance picked on this device', () => {
  it('shows and keeps a Palette picked', () => {
    const { appearance, shown, values } = appearanceOn();
    appearance.setPalette('olive');
    expect(appearance.palette).toBe('olive');
    expect(shown.at(-1)).toEqual({ palette: 'olive', theme: 'light' });
    expect(values[paletteKey]).toBe('olive');
  });

  it('shows and keeps Light or Dark picked', () => {
    const { appearance, shown, values } = appearanceOn();
    appearance.setThemeChoice('dark');
    expect(appearance.themeChoice).toBe('dark');
    expect(shown.at(-1)).toEqual({ palette: 'terracotta', theme: 'dark' });
    expect(values[themeKey]).toBe('dark');
  });
});

describe("The appearance following this device's other tabs", () => {
  it('follows and shows a Palette picked in another tab', () => {
    const { appearance, shown, values, otherTab } = appearanceOn();
    values[paletteKey] = 'ink';
    otherTab(paletteKey);
    expect(appearance.palette).toBe('ink');
    expect(shown.at(-1)).toEqual({ palette: 'ink', theme: 'light' });
  });

  it('follows and shows Light or Dark picked in another tab', () => {
    const { appearance, shown, values, otherTab } = appearanceOn();
    values[themeKey] = 'dark';
    otherTab(themeKey);
    expect(appearance.themeChoice).toBe('dark');
    expect(shown.at(-1)).toEqual({ palette: 'terracotta', theme: 'dark' });
  });

  it('falls back, and shows what it falls back to, when storage is cleared', () => {
    const { appearance, shown, values, otherTab } = appearanceOn({
      values: { [paletteKey]: 'ink', [themeKey]: 'dark' },
    });
    delete values[paletteKey];
    delete values[themeKey];
    otherTab(null);
    expect(appearance.palette).toBe('terracotta');
    expect(appearance.themeChoice).toBe('system');
    expect(shown.at(-1)).toEqual({ palette: 'terracotta', theme: 'light' });
  });

  it('shows nothing when another tab keeps another setting', () => {
    const { shown, otherTab } = appearanceOn({ values: { [paletteKey]: 'ink' } });
    otherTab('bandmate.otherSetting');
    expect(shown).toEqual([{ palette: 'ink', theme: 'light' }]);
  });
});

describe('The appearance following the system', () => {
  it('shows the system turning dark, without keeping anything', () => {
    const { appearance, shown, values, systemTurned } = appearanceOn();
    systemTurned(true);
    expect(shown.at(-1)).toEqual({ palette: 'terracotta', theme: 'dark' });
    expect(appearance.themeChoice).toBe('system');
    expect(values).toEqual({});
  });

  it('shows the Palette unchanged when Light or Dark is picked here, whatever the system turns', () => {
    const { shown, systemTurned } = appearanceOn({ values: { [themeKey]: 'light' } });
    systemTurned(true);
    expect(shown.at(-1)).toEqual({ palette: 'terracotta', theme: 'light' });
  });
});
