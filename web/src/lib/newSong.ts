// A Song just made with "New Song" opens once with its title ready to type
// over. The Song list says so with a ?new flag, which the Song page takes
// out as it opens, so a reload, Back/Forward or a later visit don't.

/** Where a Song just created opens, flagged as new. */
export function newSongPath(id: number): string {
  return `/songs/${id}?new`;
}

/**
 * Whether a Song page's query string has the new flag, and the query
 * without it.
 */
export function takeNewFlag(search: string): { isNew: boolean; rest: URLSearchParams } {
  const rest = new URLSearchParams(search);
  const isNew = rest.has('new');
  rest.delete('new');
  return { isNew, rest };
}
