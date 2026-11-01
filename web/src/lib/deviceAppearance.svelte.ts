// How the app looks on this device, as the app shares it: the Palette, Light
// or Dark and whether Track Colours show, each a Device Setting of its own,
// so a choice made in one of this device's tabs shows in all of them. The reading, keeping and
// falling back are appearance.ts's; showing it on the page is the caller's,
// handed in, so this module touches no element of the page
// (sharedAppearance.svelte.ts shows it for the app). The system's light or
// dark is the one thing it asks the browser itself, as the app has always
// asked it, since it is the browser's answer rather than anything kept here.

import {
  paletteKey,
  readPalette,
  readThemeChoice,
  readTrackColours,
  shownTheme,
  storePalette,
  storeThemeChoice,
  storeTrackColours,
  themeKey,
  trackColoursKey,
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

const trackColoursSetting = {
  key: trackColoursKey,
  read: readTrackColours,
  store: storeTrackColours,
} satisfies DeviceSettingStorage<boolean>;

/**
 * The appearance on this device: the Palette shown, Light or Dark or
 * following the system, whether Track Colours show, and the picking of each,
 * shown wherever the `show` handed in shows it. Every change shows it again, whether it's
 * picked here, picked in another of this device's tabs, left behind by a
 * cleared storage, or the system turning light or dark.
 */
export class DeviceAppearance {
  // The system's light or dark is not kept on this device, so it's no
  // Device Setting: it's the browser's answer, listened to here.
  #system = matchMedia('(prefers-color-scheme: dark)');
  #palette: DeviceSetting<Palette>;
  #theme: DeviceSetting<ThemeChoice>;
  #trackColours: DeviceSetting<boolean>;
  #showIt: (palette: Palette, theme: Theme, trackColours: boolean) => void;
  // Each setting shows its value as it's constructed, while the others are
  // still being made: those calls are left out, and the appearance shown
  // once below instead, from every value.
  #allMade = false;

  /**
   * `tabs` tells of other tabs' changes to storage: the window, in the app.
   * `show` shows the appearance, which is the whole of what this does on
   * the page.
   */
  constructor(
    storage: Storage | undefined,
    tabs: EventTarget,
    show: (palette: Palette, theme: Theme, trackColours: boolean) => void,
  ) {
    this.#showIt = show;
    const shown = () => this.#showAll();
    this.#palette = new DeviceSetting({ ...paletteSetting, shown }, storage, tabs);
    this.#theme = new DeviceSetting({ ...themeSetting, shown }, storage, tabs);
    this.#trackColours = new DeviceSetting({ ...trackColoursSetting, shown }, storage, tabs);
    this.#system.addEventListener('change', shown);
    this.#allMade = true;
    this.#showAll();
  }

  /** The Palette shown on this device. */
  get palette(): Palette {
    return this.#palette.value;
  }

  /** Light, Dark, or following the system, on this device. */
  get themeChoice(): ThemeChoice {
    return this.#theme.value;
  }

  /** Whether Track Colours show on this device, or the Palette's accent in their place. */
  get trackColours(): boolean {
    return this.#trackColours.value;
  }

  /** Shows a Palette on this device, and keeps it. */
  setPalette(value: Palette) {
    this.#palette.set(value);
  }

  /** Shows Light or Dark, or follows the system, on this device, and keeps it. */
  setThemeChoice(value: ThemeChoice) {
    this.#theme.set(value);
  }

  /** Shows Track Colours on this device, or the Palette's accent in their place, and keeps it. */
  setTrackColours(on: boolean) {
    this.#trackColours.set(on);
  }

  // Shows every current value together, so none is shown without the others.
  #showAll() {
    if (!this.#allMade) return;
    this.#showIt(this.#palette.value, shownTheme(this.#theme.value, this.#system.matches), this.#trackColours.value);
  }
}
