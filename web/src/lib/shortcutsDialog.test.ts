import { describe as group, expect, it } from 'vitest';
import { shortcuts, type Shortcut } from './shortcuts';
import { dialogGroups, searchGroups } from './shortcutsDialog';

group('dialogGroups', () => {
  it('lists every Shortcut in its group, in order, with its description and keys', () => {
    const groups = dialogGroups(shortcuts, 'other');
    expect(groups.map((g) => g.group)).toEqual([
      'Playback & recording',
      'Song editing',
      'Timeline editing',
      'Sync mode',
      'Mouse',
    ]);
    expect(groups.map((g) => g.rows.map((r) => r.name))).toEqual([
      ['Play or pause', 'Record', 'Go to the start or end'],
      ['Undo', 'Redo'],
      [
        'Delete a Clip',
        "Open a Clip's menu",
        'Seek back or forward 5 s',
        'Seek back or forward 15 s',
        'Nudge a Cue by 0.1 s',
        'Select every Clip',
        'Clear the Selection',
        'Copy the Selection',
        'Cut the Selection',
        'Paste the Clipboard',
        'Split at the playhead',
      ],
      ['Cue the next Line'],
      [
        'Add or remove a Clip',
        'Select Clips with a box',
        'Add Clips with a box',
        'Nudge a Take inside its Clip',
        'Skip snapping',
        'Zoom the Timeline',
      ],
    ]);
    expect(groups[0].rows[1]).toEqual({
      name: 'Record',
      description: 'Records a Take on the Chosen Track, or stops recording.',
      keys: [['R']],
    });
    expect(groups[0].rows[2]).toEqual({
      name: 'Go to the start or end',
      description:
        'Moves the playhead to the start or the end, from anywhere but a text field, a list, a slider, a menu or a dialog.',
      keys: [['Home'], ['End']],
    });
  });

  it('names each key as this platform does, each way of a two-way Shortcut on its own', () => {
    const songEditing = (on: 'mac' | 'other') => dialogGroups(shortcuts, on)[1].rows;
    expect(songEditing('mac')[1].keys).toEqual([['⌘⇧Z', '⌘Y']]);
    expect(songEditing('other')[1].keys).toEqual([['Ctrl+Shift+Z', 'Ctrl+Y']]);
    expect(dialogGroups(shortcuts, 'other')[2].rows[2].keys).toEqual([
      ['←', '↓'],
      ['→', '↑'],
    ]);
    expect(dialogGroups(shortcuts, 'mac')[0].rows[2].keys).toEqual([['Home'], ['End']]);
  });

  it("lists Undo and Redo as the Song's, under Song editing, not the Timeline's", () => {
    const songEditing = dialogGroups(shortcuts, 'other')[1];
    expect(songEditing.group).toBe('Song editing');
    const [undo, redo] = songEditing.rows;
    expect(undo).toMatchObject({ name: 'Undo', description: 'Undoes the last edit to the Song.' });
    expect(redo).toMatchObject({ name: 'Redo', description: 'Redoes the last edit to the Song that was undone.' });
  });

  it('lists nudging a Cue under Timeline editing, saying it works in Write mode', () => {
    const editing = dialogGroups(shortcuts, 'other')[2];
    expect(editing.group).toBe('Timeline editing');
    expect(editing.rows[4]).toEqual({
      name: 'Nudge a Cue by 0.1 s',
      description: 'Moves the focused Cue time 0.1 seconds earlier or later, in Write mode.',
      keys: [['Alt+↓'], ['Alt+↑']],
    });
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

group('searchGroups', () => {
  const found = (query: string, on: 'mac' | 'other' = 'other') =>
    searchGroups(dialogGroups(shortcuts, on), query).flatMap((g) => g.rows.map((r) => r.name));

  it('finds a Shortcut by its name, whatever the case', () => {
    expect(found('SPLIT')).toEqual(['Split at the playhead']);
  });

  it('finds a Shortcut by its keys as this platform names them', () => {
    expect(found('Ctrl+Z')).toEqual(['Undo']);
    expect(found('⌘Z', 'mac')).toEqual(['Undo']);
    expect(found('Ctrl+Z', 'mac')).toEqual([]);
    expect(found('Shift')).toEqual(['Redo', "Open a Clip's menu", 'Seek back or forward 15 s', 'Skip snapping']);
    expect(found('Backspace')).toEqual(['Delete a Clip']);
    expect(found('Shift+F10')).toEqual(["Open a Clip's menu"]);
    expect(found('Home')).toEqual(['Go to the start or end']);
  });

  it('finds a Shortcut by its description', () => {
    expect(found('pointer')).toEqual(['Zoom the Timeline']);
  });

  it('finds only the Shortcuts every word typed matches, in its name, description or keys', () => {
    expect(found('add  box ')).toEqual(['Add Clips with a box']);
    expect(found('ctrl shift')).toEqual(['Redo']);
    expect(found('shift drag snapping')).toEqual(['Skip snapping']);
  });

  it('keeps the groups a match is in, in order, and leaves out the rest', () => {
    const groups = searchGroups(dialogGroups(shortcuts, 'other'), 'undo');
    expect(groups.map((g) => [g.group, g.rows.map((r) => r.name)])).toEqual([['Song editing', ['Undo', 'Redo']]]);
    expect(searchGroups(dialogGroups(shortcuts, 'other'), 'wheel').map((g) => g.group)).toEqual(['Mouse']);
  });

  it('leaves no group when nothing matches, and every one when the search is blank', () => {
    const all = dialogGroups(shortcuts, 'other');
    expect(searchGroups(all, 'metronome')).toEqual([]);
    expect(searchGroups(all, '')).toEqual(all);
    expect(searchGroups(all, '   ')).toEqual(all);
  });
});
