import {
  applyAppearance,
  paletteKey,
  readPalette,
  readThemeChoice,
  shownTheme,
  storePalette,
  storeThemeChoice,
  themeKey,
  type Palette,
  type ThemeChoice,
} from './appearance';
import { deviceStorage } from './deviceStorage';

// How the app looks on this device, shown across the page from the moment
// the app starts: the Palette and Light or Dark picked in Settings. It
// follows the system's setting under System, and a choice made in another
// of this device's tabs.

const systemDark = matchMedia('(prefers-color-scheme: dark)');

let palette = $state(readPalette(deviceStorage()));
let themeChoice = $state(readThemeChoice(deviceStorage()));

function show() {
  const root = document.documentElement;
  applyAppearance(root, palette, shownTheme(themeChoice, systemDark.matches));
  // The browser's own bars, where it draws them, take the page's colour.
  // index.html has no theme colour of its own, which would be the wrong one
  // for every Palette and theme but one until now.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) themeColor().content = bg;
}

function themeColor(): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  return meta;
}

systemDark.addEventListener('change', show);

// Another tab kept a choice, or storage was cleared (a null key).
addEventListener('storage', (event) => {
  if (event.key !== null && event.key !== paletteKey && event.key !== themeKey) return;
  palette = readPalette(deviceStorage());
  themeChoice = readThemeChoice(deviceStorage());
  show();
});

show();

export const appearance = {
  /** The Palette shown on this device. */
  get palette(): Palette {
    return palette;
  },
  /** Light, Dark, or following the system, on this device. */
  get themeChoice(): ThemeChoice {
    return themeChoice;
  },
  /** Shows a Palette on this device, and keeps it. */
  setPalette(value: Palette) {
    palette = value;
    storePalette(deviceStorage(), value);
    show();
  },
  /** Shows Light or Dark, or follows the system, on this device, and keeps it. */
  setThemeChoice(value: ThemeChoice) {
    themeChoice = value;
    storeThemeChoice(deviceStorage(), value);
    show();
  },
};
