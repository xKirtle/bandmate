import { applyAppearance, type Palette, type Theme } from './appearance';
import { Appearance } from './appearance.svelte';
import { deviceStorage } from './deviceStorage';

// How the app looks on this device, shown across the page from the moment
// the app starts: the Palette and Light or Dark picked in Settings. It
// follows the system's setting under System, and a choice made in another
// of this device's tabs.

function show(palette: Palette, theme: Theme) {
  const root = document.documentElement;
  applyAppearance(root, palette, theme);
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

/** The appearance on this device, shown on the page as the app starts and at every change. */
export const appearance = new Appearance(deviceStorage(), window, show);
