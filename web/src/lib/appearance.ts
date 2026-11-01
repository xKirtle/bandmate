// How the app looks on this device: its Palette, whether it's light or dark,
// and whether Track Colours show. All are kept on this device, not with any
// Song, and fall back to Terracotta, following the system and showing Track
// Colours without storage. index.html's script reads the same keys to set
// them before the page first paints.

/** The Palettes, Terracotta first as the default. */
export const palettes = [
  { id: 'terracotta', label: 'Terracotta' },
  { id: 'ink', label: 'Ink' },
  { id: 'olive', label: 'Olive' },
] as const;
export type Palette = (typeof palettes)[number]['id'];

/** Light or dark, as the app shows it. */
export type Theme = 'light' | 'dark';

/** The choice of light or dark: the system's, or one of them whatever the system says. */
export const themeChoices = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
] as const;
export type ThemeChoice = (typeof themeChoices)[number]['id'];

/** Where the Palette is kept on this device, unless it's Terracotta. */
export const paletteKey = 'bandmate.palette';
/** Where Light or Dark is kept on this device, unless it follows the system. */
export const themeKey = 'bandmate.theme';
/** Where it's kept on this device that Track Colours are off, unless they're on. */
export const trackColoursKey = 'bandmate.trackColours';

/** The Palette picked on this device, Terracotta until another is. */
export function readPalette(storage: Storage | undefined): Palette {
  return readChoice(storage, paletteKey, palettes) ?? 'terracotta';
}

/** Keeps the Palette picked on this device, forgetting it once Terracotta again. */
export function storePalette(storage: Storage | undefined, palette: Palette) {
  storeChoice(storage, paletteKey, palette === 'terracotta' ? null : palette);
}

/** Light or Dark as picked on this device, or following the system until one is. */
export function readThemeChoice(storage: Storage | undefined): ThemeChoice {
  return readChoice(storage, themeKey, themeChoices) ?? 'system';
}

/** Keeps Light or Dark on this device, forgetting it once following the system again. */
export function storeThemeChoice(storage: Storage | undefined, choice: ThemeChoice) {
  storeChoice(storage, themeKey, choice === 'system' ? null : choice);
}

/** Whether this device shows Track Colours, or the Palette's accent in their place. */
export function readTrackColours(storage: Storage | undefined): boolean {
  return readChoice(storage, trackColoursKey, [{ id: 'off' }]) !== 'off';
}

/** Keeps whether this device shows Track Colours, forgetting it once on again. */
export function storeTrackColours(storage: Storage | undefined, on: boolean) {
  storeChoice(storage, trackColoursKey, on ? null : 'off');
}

/** Whether the app shows light or dark, for a choice and whether the system is dark. */
export function shownTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  if (choice !== 'system') return choice;
  return systemDark ? 'dark' : 'light';
}

/**
 * Shows a Palette, light or dark, across the page: `data-palette` on the
 * root picks the Palette, Terracotta when it's absent, `data-theme` light or
 * dark, and `data-track-colours` puts the accent in Track Colours' place
 * when it's `off` (palettes.css).
 */
export function applyAppearance(root: HTMLElement, palette: Palette, theme: Theme, trackColours: boolean) {
  if (palette === 'terracotta') delete root.dataset.palette;
  else root.dataset.palette = palette;
  root.dataset.theme = theme;
  if (trackColours) delete root.dataset.trackColours;
  else root.dataset.trackColours = 'off';
}

function readChoice<Id extends string>(
  storage: Storage | undefined,
  key: string,
  choices: readonly { id: Id }[],
): Id | undefined {
  try {
    const kept = storage?.getItem(key);
    return choices.find((choice) => choice.id === kept)?.id;
  } catch {
    return undefined;
  }
}

function storeChoice(storage: Storage | undefined, key: string, value: string | null) {
  try {
    if (value == null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Not kept, e.g. in a private window; the choice still applies until reload.
  }
}
