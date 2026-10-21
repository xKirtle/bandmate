// How the app looks on this device, as the app shares it: the Palette and
// Light or Dark, each a Device Setting of its own, so a choice made in one
// of this device's tabs shows in all of them. The reading, keeping and
// falling back are appearance.ts's; showing it on the page is the caller's,
// handed in, so this module needs no DOM (sharedAppearance.svelte.ts shows
// it for the app).

import {
  paletteKey,
  readPalette,
  readThemeChoice,
  shownTheme,
  storePalette,
  storeThemeChoice,
  themeKey,
  type Palette,
  type Theme,
  type ThemeChoice,
} from './appearance';
import { DeviceSetting, type DeviceSettingStorage } from './deviceSetting.svelte';

const paletteSetting = {
  key: paletteKey,
  read: readPalette,
  store: storePalette,
} satisfies DeviceSettingStorage<Palette>;

const themeSetting = {
  key: themeKey,
  read: readThemeChoice,
  store: storeThemeChoice,
} satisfies DeviceSettingStorage<ThemeChoice>;

/**
 * The appearance on this device: the Palette shown, Light or Dark or
 * following the system, and the picking of either, shown wherever the
 * `show` handed in shows it. Every change shows it again, whether it's
 * picked here, picked in another of this device's tabs, left behind by a
 * cleared storage, or the system turning light or dark.
 */
export class Appearance {
  // The system's light or dark is not kept on this device, so it's no
  // Device Setting: it's the browser's answer, listened to here.
  #system = matchMedia('(prefers-color-scheme: dark)');
  #palette: DeviceSetting<Palette>;
  #theme: DeviceSetting<ThemeChoice>;
  #showing: (palette: Palette, theme: Theme) => void;
  // Each setting shows its value as it's constructed, while the other is
  // still being made: those two calls are left out, and the appearance
  // shown once below instead, from both values.
  #both = false;

  /**
   * `tabs` tells of other tabs' changes to storage: the window, in the app.
   * `show` shows the appearance, which is the whole of what this does on
   * the page.
   */
  constructor(storage: Storage | undefined, tabs: EventTarget, show: (palette: Palette, theme: Theme) => void) {
    this.#showing = show;
    const shown = () => this.#show();
    this.#palette = new DeviceSetting({ ...paletteSetting, shown }, storage, tabs);
    this.#theme = new DeviceSetting({ ...themeSetting, shown }, storage, tabs);
    this.#system.addEventListener('change', shown);
    this.#both = true;
    this.#show();
  }

  /** The Palette shown on this device. */
  get palette(): Palette {
    return this.#palette.value;
  }

  /** Light, Dark, or following the system, on this device. */
  get themeChoice(): ThemeChoice {
    return this.#theme.value;
  }

  /** Shows a Palette on this device, and keeps it. */
  setPalette(value: Palette) {
    this.#palette.set(value);
  }

  /** Shows Light or Dark, or follows the system, on this device, and keeps it. */
  setThemeChoice(value: ThemeChoice) {
    this.#theme.set(value);
  }

  // Shows both current values together, so neither is shown without the other.
  #show() {
    if (!this.#both) return;
    this.#showing(this.#palette.value, shownTheme(this.#theme.value, this.#system.matches));
  }
}
