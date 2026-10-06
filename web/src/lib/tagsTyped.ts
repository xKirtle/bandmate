// What's typed into the Tags field, as Tags. A comma finishes a Tag, so a
// Tag's name never has one; a space doesn't, so a name can have several words.

/**
 * The names finished in `text`, trimmed and without blank pieces, and the
 * `rest` still being typed: what comes after the last comma, from its first
 * letter. With `all`, as
 * when names are pasted, every piece is finished and nothing is left typed.
 */
export function finishedTags(text: string, all = false): { names: string[]; rest: string } {
  const pieces = text.split(',');
  // The space after a comma only parts one name from the next.
  const rest = all ? '' : (pieces.pop() ?? '').trimStart();
  const names = pieces.map((p) => p.trim()).filter((p) => p !== '');
  return { names, rest };
}

/**
 * The Tags `carried` with `names` added. A name carried already, ignoring
 * case, adds nothing; one a Tag has (in `known`) takes that Tag's spelling.
 */
export function addTags(carried: readonly string[], known: readonly string[], names: readonly string[]): string[] {
  const tags = [...carried];
  const has = new Set(carried.map((t) => t.toLowerCase()));
  for (const name of names) {
    const folded = name.toLowerCase();
    if (has.has(folded)) continue;
    has.add(folded);
    tags.push(known.find((k) => k.toLowerCase() === folded) ?? name);
  }
  return tags;
}
