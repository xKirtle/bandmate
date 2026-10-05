// How the app looks on this device: its Palette, and whether it's light or
// dark. Both are kept on this device, not with any Song, and fall back to
// Terracotta and following the system without storage. index.html's script
// reads the same keys to set them before the page first paints.

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

/** Whether the app shows light or dark, for a choice and whether the system is dark. */
export function shownTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  if (choice !== 'system') return choice;
  return systemDark ? 'dark' : 'light';
}

/**
 * Shows a Palette, light or dark, across the page: `data-palette` on the
 * root picks the Palette, Terracotta when it's absent, and `data-theme`
 * light or dark (palettes.css).
 */
export function applyAppearance(root: HTMLElement, palette: Palette, theme: Theme) {
  if (palette === 'terracotta') delete root.dataset.palette;
  else root.dataset.palette = palette;
  root.dataset.theme = theme;
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
