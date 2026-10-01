import { describe as group, expect, it } from 'vitest';
import { shortcuts, type Shortcut } from './shortcuts';
import { dialogGroups } from './shortcutsDialog';

group('dialogGroups', () => {
  it('lists every Shortcut in its group, in order, with its description and keys', () => {
    const groups = dialogGroups(shortcuts, 'other');
    expect(groups.map((g) => g.group)).toEqual(['Playback & recording', 'Timeline editing', 'Sync mode', 'Mouse']);
    expect(groups.map((g) => g.rows.map((r) => r.name))).toEqual([
      ['Play or pause', 'Record'],
      [
        'Undo',
        'Redo',
        'Delete a Clip',
        "Open a Clip's menu",
        'Seek back or forward 5 s',
        'Seek back or forward 15 s',
        'Go to the start or end',
        "Step a menu's number field by its step",
        "Step a menu's number field by its Shift step",
      ],
      ['Cue the next Line', 'Nudge a Cue by 0.1 s'],
      ['Slip a Take inside its Clip', 'Skip snapping', 'Zoom the Timeline'],
    ]);
    expect(groups[0].rows[1]).toEqual({
      name: 'Record',
      description: 'Records a Take on the Chosen Track, or stops recording.',
      keys: [['R']],
    });
  });

  it('names each key as this platform does, each way of a two-way Shortcut on its own', () => {
    const editing = (on: 'mac' | 'other') => dialogGroups(shortcuts, on)[1].rows;
    expect(editing('mac')[1].keys).toEqual([['⌘⇧Z', '⌘Y']]);
    expect(editing('other')[1].keys).toEqual([['Ctrl+Shift+Z', 'Ctrl+Y']]);
    expect(editing('other')[4].keys).toEqual([
      ['←', '↓'],
      ['→', '↑'],
    ]);
    expect(editing('mac')[6].keys).toEqual([['Home'], ['End']]);
  });

  it('lists a Shortcut added to the list, and leaves out a group with none', () => {
    const list: Record<string, Shortcut> = {
      loop: {
        name: 'Loop',
        group: 'Playback & recording',
        description: 'Turns the Loop on or off.',
        keys: [{ key: 'l' }],
      },
      zoomToFit: {
        name: 'Zoom to fit',
        group: 'Mouse',
        description: 'Fits the whole Timeline in view.',
        keys: [{ key: 'wheel', alt: true }],
      },
    };
    expect(dialogGroups(list, 'other')).toEqual([
      {
        group: 'Playback & recording',
        rows: [{ name: 'Loop', description: 'Turns the Loop on or off.', keys: [['L']] }],
      },
      {
        group: 'Mouse',
        rows: [{ name: 'Zoom to fit', description: 'Fits the whole Timeline in view.', keys: [['Alt+wheel']] }],
      },
    ]);
  });
});
