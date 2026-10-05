import { describe, expect, it } from 'vitest';
import { byFolder, groupTicked, tickGroup } from './pickList';

const song = (id: number, folder: string | null) => ({ id, folder });

describe('byFolder', () => {
  it('groups items under their Folders, sorted by name ignoring case, then lists those in none', () => {
    const items = [song(1, 'summer EP'), song(2, null), song(3, 'Demos'), song(4, 'summer EP'), song(5, null)];

    expect(byFolder(items, (s) => s.folder)).toEqual({
      folders: [
        { folder: 'Demos', items: [song(3, 'Demos')] },
        { folder: 'summer EP', items: [song(1, 'summer EP'), song(4, 'summer EP')] },
      ],
      loose: [song(2, null), song(5, null)],
    });
  });

  it('lists every item as loose when none sits in a Folder', () => {
    const items = [song(1, null), song(2, null)];

    expect(byFolder(items, (s) => s.folder)).toEqual({ folders: [], loose: items });
  });
});

describe('groupTicked', () => {
  const ticked = (id: number) => id === 1 || id === 2;

  it('is all when every item is ticked', () => {
    expect(groupTicked([1, 2], ticked)).toBe('all');
  });

  it('is some when only some are', () => {
    expect(groupTicked([1, 3], ticked)).toBe('some');
  });

  it('is none when none are', () => {
    expect(groupTicked([3, 4], ticked)).toBe('none');
  });
});

describe('tickGroup', () => {
  it('picks every item in the group when not all are ticked, keeping the other picks', () => {
    const picked = new Set([1, 9]);

    expect(tickGroup(picked, [1, 2, 3], (id) => picked.has(id))).toEqual(new Set([1, 9, 2, 3]));
  });

  it('unpicks every item in the group when all are ticked, keeping the other picks', () => {
    const picked = new Set([1, 2, 9]);

    expect(tickGroup(picked, [1, 2], (id) => picked.has(id))).toEqual(new Set([9]));
  });

  it("counts a locked item as ticked, and unpicks what's under its lock too", () => {
    const picked = new Set([1, 2]);
    const locked = new Set([3]);

    expect(tickGroup(picked, [1, 2, 3], (id) => locked.has(id) || picked.has(id))).toEqual(new Set());
  });
});
