import { describe, expect, it } from 'vitest';
import { formatCue, typedCue } from './cues';
import { Saves } from './saves.svelte';
import { emptySong, FakeSongServer } from './songServerFake';
import { cancelOnEscape, leaveOnEscape, TypedField, type Parsed } from './typedField.svelte';

/** A Saves for the Song the server holds, as the Song page makes one once it's loaded. */
async function savesFor(server: FakeSongServer) {
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  return new Saves({ server, song, timeline, wait: () => Promise.resolve() });
}

/** Lets everything waiting on the fake server's answers run. */
const settled = () => new Promise((done) => setTimeout(done));

/** The Song's Key as a field: blank goes back, and "H" isn't a Key. */
const parseKey = (typed: string): Parsed<string> => {
  const key = typed.trim();
  if (key === '') return 'back';
  if (key === 'H') return { message: 'H isn’t a Key' };
  return { value: key };
};

/** The Song's Key, typed in place and saved through Saves. */
async function keyField() {
  const server = new FakeSongServer(emptySong({ key: 'C' }));
  const saves = await savesFor(server);
  const committed: string[] = [];
  const field = new TypedField<string>({
    saved: () => saves.saved.key,
    format: (key) => key,
    parse: parseKey,
    commit: (key) => {
      committed.push(key);
      return saves.change((at) => server.update(at, { key }));
    },
    typing: saves.typing,
  });
  return { server, saves, field, committed };
}

describe('TypedField', () => {
  it('shows what’s saved until typed in, then what’s typed, unsaved until committed', async () => {
    const { server, saves, field } = await keyField();
    expect(field.shown).toBe('C');
    expect(saves.unsaved).toBe(false);
    field.shown = 'Am';
    expect(field.shown).toBe('Am');
    expect(saves.unsaved).toBe(true);
    expect(field.commit()).toBe(true);
    await settled();
    expect(server.song.key).toBe('Am');
    expect(field.shown).toBe('Am');
    expect(saves.unsaved).toBe(false);
  });

  it('does nothing when what’s typed is what’s saved', async () => {
    const { saves, field, committed } = await keyField();
    field.shown = 'Am';
    field.shown = 'C';
    expect(saves.unsaved).toBe(false);
    expect(field.commit()).toBe(true);
    field.shown = ' C ';
    expect(field.commit()).toBe(true);
    expect(committed).toEqual([]);
    expect(field.shown).toBe('C');
  });

  it('goes back to what’s saved when its parse says so', async () => {
    const { saves, field, committed } = await keyField();
    field.shown = '  ';
    expect(field.commit()).toBe(true);
    expect(committed).toEqual([]);
    expect(field.shown).toBe('C');
    expect(saves.unsaved).toBe(false);
  });

  it('stays open with a message when its parse refuses what’s typed, until typed in again', async () => {
    const { saves, field, committed } = await keyField();
    field.shown = 'H';
    expect(field.commit()).toBe(false);
    expect(field.message).toBe('H isn’t a Key');
    expect(field.shown).toBe('H');
    expect(saves.unsaved).toBe(true);
    expect(committed).toEqual([]);
    field.shown = 'Hm';
    expect(field.message).toBeNull();
  });

  it('cancels what’s typed, showing what’s saved again', async () => {
    const { saves, field, committed } = await keyField();
    field.shown = 'H';
    field.commit();
    field.cancel();
    expect(field.shown).toBe('C');
    expect(field.message).toBeNull();
    expect(saves.unsaved).toBe(false);
    field.destroy();
    expect(committed).toEqual([]);
  });

  it('commits what’s typed when destroyed, and leaves the list', async () => {
    const { server, saves, field } = await keyField();
    field.shown = 'Am';
    field.destroy();
    await settled();
    expect(server.song.key).toBe('Am');
    expect(saves.unsaved).toBe(false);
  });

  it('is on the list again when typed in after it was destroyed, e.g. its field shown again', async () => {
    const { saves, field } = await keyField();
    field.destroy();
    field.shown = 'Am';
    expect(saves.unsaved).toBe(true);
    field.cancel();
    expect(saves.unsaved).toBe(false);
  });

  it('drops what’s typed when destroyed if its parse refuses it', async () => {
    const { saves, field, committed } = await keyField();
    field.shown = 'H';
    field.destroy();
    expect(committed).toEqual([]);
    expect(saves.unsaved).toBe(false);
  });

  it('drops what’s typed, sending nothing, once what it belongs to has gone, e.g. undone', async () => {
    const server = new FakeSongServer(emptySong({ key: 'C' }));
    const saves = await savesFor(server);
    const there = { now: true };
    const committed: string[] = [];
    const field = new TypedField<string>({
      saved: () => saves.saved.key,
      format: (key) => key,
      parse: parseKey,
      commit: (key) => void committed.push(key),
      exists: () => there.now,
      typing: saves.typing,
    });
    field.shown = 'Am';
    there.now = false;
    expect(field.commit()).toBe(true);
    field.shown = 'Am7';
    field.destroy();
    expect(committed).toEqual([]);
    expect(saves.unsaved).toBe(false);
    expect(saves.saveError).toBeNull();
  });

  it('shows what’s saved again once a commit fails', async () => {
    const { server, saves, field } = await keyField();
    server.failNext(1);
    field.shown = 'Am';
    field.commit();
    expect(field.shown).toBe('Am');
    await settled();
    expect(field.shown).toBe('C');
    expect(saves.unsaved).toBe(false);
  });

  it('keeps what’s typed, unsaved, when its save is refused as the Song changed elsewhere', async () => {
    const server = new FakeSongServer(emptySong({ key: 'C' }));
    const saves = await savesFor(server);
    const field = new TypedField<string>({
      saved: () => saves.saved.key,
      format: (key) => key,
      parse: parseKey,
      commit: (key) => saves.submit((at) => server.update(at, { key })),
      typing: saves.typing,
    });
    server.changeElsewhere({ title: 'From another tab' });
    field.shown = 'Am';
    field.commit();
    await settled();
    expect(saves.stale).toBe(true);
    expect(field.shown).toBe('Am');
    expect(saves.unsaved).toBe(true);
  });

  it('keeps typing newer than a commit on its way, and doesn’t send a commit twice', async () => {
    const { server, saves, field, committed } = await keyField();
    const release = server.holdNextAnswer();
    field.shown = 'Am';
    field.commit();
    field.commit();
    field.shown = 'Am7';
    release();
    await settled();
    expect(committed).toEqual(['Am']);
    expect(field.shown).toBe('Am7');
    expect(saves.unsaved).toBe(true);
    field.commit();
    await settled();
    expect(server.song.key).toBe('Am7');
  });

  it('takes back what’s typed on Esc, and nothing on another key', async () => {
    const { saves, field } = await keyField();
    const key = cancelOnEscape(field);
    field.shown = 'Am';
    key({ key: 'a' });
    expect(field.shown).toBe('Am');
    key({ key: 'Escape' });
    expect(field.shown).toBe('C');
    expect(saves.unsaved).toBe(false);
  });

  it('in a notes field, leaves it on Esc, keeping and saving what’s typed', async () => {
    const { server, field } = await keyField();
    let blurred = false;
    field.shown = 'Am';
    leaveOnEscape(field)({ key: 'Escape', currentTarget: { blur: () => (blurred = true) } });
    expect(blurred).toBe(true);
    expect(field.shown).toBe('Am');
    await settled();
    expect(server.song.key).toBe('Am');
  });

  it('keeps a refresh from replacing the Song while typed, showing it changed elsewhere instead', async () => {
    const { server, saves, field } = await keyField();
    field.shown = 'Am';
    server.changeElsewhere({ title: 'From another tab' });
    await saves.refresh();
    expect(saves.stale).toBe(true);
    expect(saves.song.title).toBe('Untitled');
    field.cancel();
    await saves.refresh();
    expect(saves.stale).toBe(false);
    expect(saves.song.title).toBe('From another tab');
  });
});

/** A Song of one Section of one Line, cued at 45.03 s. */
const cuedSong = () =>
  emptySong({
    arrangement: [1],
    sections: [
      {
        id: 1,
        label: 'Verse',
        alternates: [
          {
            id: 1,
            name: '',
            active: true,
            lines: [{ id: 10, text: 'One', lyrics: 'One', chords: [], chordLine: false, cue: 45.03 }],
          },
        ],
      },
    ],
  });

/** The Line's Cue time, typed in place as its Cue field does, and saved through Saves. */
async function cueField() {
  const server = new FakeSongServer(cuedSong());
  const saves = await savesFor(server);
  const cue = () => saves.song.sections[0].alternates[0].lines[0].cue;
  const field = new TypedField<number | null>({
    saved: cue,
    format: (at) => (at === null ? '' : formatCue(at)),
    parse: (typed) => typedCue(typed, cue()),
    commit: (to) => void saves.cue({ kind: 'setLineCue', lineId: 10, cue: to }, 'the Cue of Line 1 of Verse'),
    typing: saves.typing,
  });
  const serverCue = () => server.song.sections[0].alternates[0].lines[0].cue;
  return { saves, field, serverCue };
}

describe('TypedField, a Cue’s time', () => {
  it('saves a time typed, shown at once', async () => {
    const { saves, field, serverCue } = await cueField();
    expect(field.shown).toBe('0:45.0');
    field.shown = '1:02';
    expect(field.commit()).toBe(true);
    expect(field.shown).toBe('1:02.0');
    expect(saves.unsaved).toBe(true);
    await settled();
    expect(serverCue()).toBe(62);
    expect(saves.unsaved).toBe(false);
  });

  it('clears the Cue when typed empty', async () => {
    const { field, serverCue } = await cueField();
    field.shown = ' ';
    field.commit();
    await settled();
    expect(serverCue()).toBeNull();
  });

  it('leaves a Cue finer than tenths as it is when typed as shown', async () => {
    const { saves, field, serverCue } = await cueField();
    field.shown = ' 0:45.0 ';
    expect(field.commit()).toBe(true);
    expect(saves.pending).toBe(0);
    await settled();
    expect(serverCue()).toBe(45.03);
  });

  it('stays open, marked, on what isn’t a time, and drops it once left', async () => {
    const { saves, field, serverCue } = await cueField();
    field.shown = 'soon';
    expect(field.commit()).toBe(false);
    expect(field.message).toBe('Type a time like 45, 0:45, 0:45.25 or 1:02');
    expect(saves.unsaved).toBe(true);
    field.destroy();
    expect(field.shown).toBe('0:45.0');
    expect(saves.unsaved).toBe(false);
    await settled();
    expect(serverCue()).toBe(45.03);
  });

  it('saves a time typed as its field goes', async () => {
    const { field, serverCue } = await cueField();
    field.shown = '50';
    field.destroy();
    await settled();
    expect(serverCue()).toBe(50);
  });
});

describe('Saves, the list of edits being typed', () => {
  it('reports unsaved edits while an edit on it isn’t saved, until it leaves', async () => {
    const server = new FakeSongServer();
    const saves = await savesFor(server);
    const label = { unsaved: false, typed: 0, section: 3 };
    const leave = saves.typing(label);
    expect(saves.unsaved).toBe(false);
    label.unsaved = true;
    expect(saves.unsaved).toBe(true);
    leave();
    expect(saves.unsaved).toBe(false);
  });
});
