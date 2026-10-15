// The Languages a Song's Lines can be sung in, by their BCP 47 codes,
// and picking a Song's: an ordered list, never empty. Bandmate lists those
// it rhymes in (sharedLanguages.svelte.ts), and refuses a Language not on
// its list; the page keeps none of its own.

/** A Language Bandmate suggests Rhymes in. */
export interface LanguageInfo {
  code: string;
  name: string;
}

/** A Language's name, or its code as it is if `known` has none for it. */
export function languageName(code: string, known: readonly LanguageInfo[]): string {
  return known.find((l) => l.code === code)?.name ?? code;
}

/** A Song's Languages named, in their order, e.g. "English, Portuguese (Portugal)". */
export function languagesLabel(picked: readonly string[], known: readonly LanguageInfo[]): string {
  return picked.map((code) => languageName(code, known)).join(', ');
}

/** A Language as the picker offers it: ticked or not. */
export interface LanguageChoice extends LanguageInfo {
  picked: boolean;
}

/**
 * The Languages the picker offers: those picked first, in the Song's order,
 * then the rest as Bandmate lists them. Only those Bandmate rhymes in.
 */
export function languageChoices(picked: readonly string[], known: readonly LanguageInfo[]): LanguageChoice[] {
  const first = picked.flatMap((code) => known.filter((l) => l.code === code));
  const rest = known.filter((l) => !picked.includes(l.code));
  const choice = (l: LanguageInfo, picked: boolean): LanguageChoice => ({ code: l.code, name: l.name, picked });
  return [...first.map((l) => choice(l, true)), ...rest.map((l) => choice(l, false))];
}

/**
 * The Languages once one is ticked on, added after the rest, or off. The
 * last one is kept: a Song is always sung in at least one.
 */
export function pickLanguage(picked: readonly string[], code: string, on: boolean): string[] {
  const rest = picked.filter((p) => p !== code);
  if (on) return [...rest, code];
  return rest.length > 0 ? rest : [...picked];
}

/** The Languages once one moves a place earlier (-1) or later (1); at either end, as they are. */
export function moveLanguage(picked: readonly string[], code: string, by: -1 | 1): string[] {
  const from = picked.indexOf(code);
  const to = from + by;
  if (from < 0 || to < 0 || to >= picked.length) return [...picked];
  const next = [...picked];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
