// How a PickList groups its items by Folder, and ticks a whole group at once.

/** A Folder's items in a PickList, under its name. */
export interface FolderGroup<T> {
  folder: string;
  items: T[];
}

/**
 * Items grouped under the names of the Folders they sit in, the Folders
 * sorted by name ignoring case and each one's items in the order given,
 * then the items in no Folder.
 */
export function byFolder<T>(
  items: readonly T[],
  folderOf: (item: T) => string | null,
): { folders: FolderGroup<T>[]; loose: T[] } {
  const groups = new Map<string, T[]>();
  const loose: T[] = [];
  for (const item of items) {
    const folder = folderOf(item);
    if (folder === null) {
      loose.push(item);
      continue;
    }
    const group = groups.get(folder);
    if (group) group.push(item);
    else groups.set(folder, [item]);
  }
  const folders = [...groups].map(([folder, items]) => ({ folder, items }));
  folders.sort((a, b) => a.folder.localeCompare(b.folder, undefined, { sensitivity: 'base' }));
  return { folders, loose };
}

/** Whether all, some or none of a group's items, by id, are ticked. */
export function groupTicked(ids: readonly number[], ticked: (id: number) => boolean): 'all' | 'some' | 'none' {
  const count = ids.filter(ticked).length;
  if (count === 0) return 'none';
  return count === ids.length ? 'all' : 'some';
}

/**
 * The picks after a group's tick is clicked: every item in it picked, or,
 * when all are ticked already, none of them, those under a lock too. Picks
 * outside the group are kept.
 */
export function tickGroup(
  picked: ReadonlySet<number>,
  ids: readonly number[],
  ticked: (id: number) => boolean,
): Set<number> {
  const next = new Set(picked);
  if (groupTicked(ids, ticked) === 'all') for (const id of ids) next.delete(id);
  else for (const id of ids) next.add(id);
  return next;
}
