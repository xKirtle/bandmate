import { describe, expect, it } from 'vitest';
import { Saves } from './saves.svelte';
import type { Master, MasterChanges, SongAt } from './api';
import { detailFields, masterFields } from './songFields';
import { emptySong, FakeSongServer } from './songServerFake';

/** Lets everything waiting on the fake server's answers run. */
const settled = () => new Promise((done) => setTimeout(done));

/** The Song's Details as the Song page types them, saved through Saves to the fake server. */
async function details(fields: Parameters<typeof emptySong>[0] = {}) {
  const server = new FakeSongServer(emptySong({ title: 'Anthem', key: 'C', bpm: 90, capo: null, ...fields }));
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  const saves = new Saves({ server, song, timeline, wait: () => Promise.resolve() });
  return { server, saves, details: detailFields(saves, (at, changes) => server.update(at, changes)) };
}

describe('detailFields', () => {
  it('saves a title, Key and tuning typed, trimmed', async () => {
    const { server, details: d } = await details();
    d.title.shown = ' Night Drive ';
    d.title.commit();
    d.key.shown = 'Em ';
    d.key.commit();
    d.tuning.shown = ' Drop D';
    d.tuning.commit();
    await settled();
    expect(server.song).toMatchObject({ title: 'Night Drive', key: 'Em', tuning: 'Drop D' });
  });

  it('saves the notes as typed, untrimmed', async () => {
    const { server, details: d } = await details();
    d.notes.shown = 'Slower live.\n';
    d.notes.commit();
    await settled();
    expect(server.song.notes).toBe('Slower live.\n');
  });

  it('saves a BPM or Capo typed as a whole number, and blank as none', async () => {
    const { server, details: d } = await details();
    d.bpm.shown = ' 128 ';
    d.bpm.commit();
    d.capo.shown = '4';
    d.capo.commit();
    await settled();
    expect(server.song).toMatchObject({ bpm: 128, capo: 4 });
    d.bpm.shown = ' ';
    d.bpm.commit();
    await settled();
    expect(server.song.bpm).toBeNull();
  });

  it('says a BPM or Capo that isn’t a whole number must be, and goes back', async () => {
    const { server, saves, details: d } = await details();
    d.bpm.shown = '12.5';
    expect(d.bpm.commit()).toBe(true);
    expect(saves.saveError).toBe('BPM must be a whole number');
    expect(d.bpm.shown).toBe('90');
    d.capo.shown = 'two';
    d.capo.commit();
    expect(saves.saveError).toBe('Capo must be a whole number');
    expect(d.capo.shown).toBe('');
    expect(saves.unsaved).toBe(false);
    await settled();
    expect(server.landed).toBe(0);
  });

  it('does nothing when what’s typed is what’s saved', async () => {
    const { server, details: d } = await details();
    d.title.shown = ' Anthem ';
    d.title.commit();
    d.bpm.shown = '090';
    d.bpm.commit();
    await settled();
    expect(server.landed).toBe(0);
    expect(d.bpm.shown).toBe('90');
  });

  it('shows what’s saved again once a save fails', async () => {
    const { server, saves, details: d } = await details();
    server.failNext(1);
    d.title.shown = 'Ballad';
    d.title.commit();
    await settled();
    expect(d.title.shown).toBe('Anthem');
    expect(saves.saveError).not.toBeNull();
    expect(saves.unsaved).toBe(false);
  });

  it('keeps what’s typed, unsaved, when refused as the Song changed elsewhere', async () => {
    const { server, saves, details: d } = await details();
    server.changeElsewhere({ bpm: 120 });
    d.capo.shown = '3';
    d.capo.commit();
    await settled();
    expect(saves.stale).toBe(true);
    expect(d.capo.shown).toBe('3');
    expect(saves.unsaved).toBe(true);
  });

  it('is unsaved while typed, takes it back on cancel, and saves it when destroyed', async () => {
    const { server, saves, details: d } = await details();
    d.key.shown = 'Am';
    expect(saves.unsaved).toBe(true);
    d.key.cancel();
    expect(d.key.shown).toBe('C');
    expect(saves.unsaved).toBe(false);
    d.notes.shown = 'Half time';
    d.notes.destroy();
    await settled();
    expect(server.song.notes).toBe('Half time');
    expect(saves.unsaved).toBe(false);
  });
});

/** A Master of the Song, as uploaded. */
const master = (id: number, name: string): Master => ({
  id,
  name,
  main: id === 1,
  notes: '',
  fileName: `${name}.wav`,
  contentType: 'audio/wav',
  size: 1000,
  duration: 180,
  addedAt: '2026-01-01T00:00:00Z',
});

/** A Song's second Master's name and notes as Masters types them, saved through Saves to the fake server. */
async function secondMaster() {
  const server = new FakeSongServer(emptySong({ masters: [master(1, 'Studio'), master(2, 'Live')] }));
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  const saves = new Saves({ server, song, timeline, wait: () => Promise.resolve() });
  const update = (at: SongAt, id: number, changes: MasterChanges) =>
    server.update(at, { masters: server.song.masters.map((m) => (m.id === id ? { ...m, ...changes } : m)) });
  const refused: string[] = [];
  const fields = masterFields(2, {
    master: () => saves.saved.masters.find((m) => m.id === 2),
    change: saves.change,
    typing: saves.typing,
    update,
    refuse: (message) => refused.push(message),
  });
  const saved = () => server.song.masters.find((m) => m.id === 2)!;
  return { server, saves, fields, refused, saved };
}

describe('masterFields', () => {
  it('saves a name typed, trimmed, and notes as typed', async () => {
    const { fields, saved } = await secondMaster();
    fields.name.shown = ' Live at the Roxy ';
    fields.name.commit();
    fields.notes.shown = 'Crowd too loud. ';
    fields.notes.commit();
    await settled();
    expect(saved()).toMatchObject({ name: 'Live at the Roxy', notes: 'Crowd too loud. ' });
  });

  it('refuses a blank name, saying why, and goes back', async () => {
    const { server, saves, fields, refused } = await secondMaster();
    fields.name.shown = '  ';
    expect(fields.name.commit()).toBe(true);
    expect(refused).toEqual(['A Master needs a name once there are several.']);
    expect(fields.name.shown).toBe('Live');
    expect(saves.unsaved).toBe(false);
    await settled();
    expect(server.landed).toBe(0);
  });

  it('shows what’s saved again once a save fails, or is refused as the Song changed elsewhere', async () => {
    const { server, fields } = await secondMaster();
    server.failNext(1);
    fields.name.shown = 'Demo';
    fields.name.commit();
    await settled();
    expect(fields.name.shown).toBe('Live');
    server.changeElsewhere();
    fields.notes.shown = 'Rough';
    fields.notes.commit();
    await settled();
    expect(fields.notes.shown).toBe('');
  });

  it('is unsaved while typed, takes a name back on cancel, and saves notes when destroyed', async () => {
    const { saves, fields, saved } = await secondMaster();
    fields.name.shown = 'Demo';
    expect(saves.unsaved).toBe(true);
    fields.name.cancel();
    expect(fields.name.shown).toBe('Live');
    expect(saves.unsaved).toBe(false);
    fields.notes.shown = 'Rough';
    fields.notes.destroy();
    await settled();
    expect(saved().notes).toBe('Rough');
    expect(saves.unsaved).toBe(false);
  });
});
