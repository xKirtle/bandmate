import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from './api';
import type { LyricSheetChange } from './lyricSheetChanges';
import { LyricSheetEditing } from './lyricSheetEditing.svelte';
import { Saves } from './saves.svelte';
import { TypedField } from './typedField.svelte';
import { emptySong, FakeSongServer } from './songServerFake';

/** A Song of one Section, the Verse, whose one Alternate has two Lines. */
const verseSong = () =>
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
            lines: [
              { id: 10, text: 'One', lyrics: 'One', chords: [], chordLine: false, cue: null },
              { id: 11, text: 'Two', lyrics: 'Two', chords: [], chordLine: false, cue: null },
            ],
          },
        ],
      },
    ],
  });

/** The text of the Verse's Alternate. */
const textOf = (song: Song) => song.sections[0].alternates[0].lines.map((l) => l.text).join('\n');

/** The Verse's Alternate's Lines changed to the text given, a row each, as changed elsewhere. */
const withText = (song: Song, text: string): Partial<Song> => {
  const [verse] = song.sections;
  const [alternate] = verse.alternates;
  const lines = text.split('\n').map((t, i) => ({ ...alternate.lines[i], text: t, lyrics: t }));
  return { sections: [{ ...verse, alternates: [{ ...alternate, lines }] }] };
};

/**
 * Lyric Sheet editing on top of Saves for the Song the server holds, as the
 * Song page makes it, with how many times it ended Sync mode.
 */
async function editingFor(server: FakeSongServer) {
  const [song, timeline] = await Promise.all([server.getSong(), server.getTimeline()]);
  const saves = new Saves({ server, song, timeline });
  const sync = { ended: 0 };
  const editing = new LyricSheetEditing(saves, () => sync.ended++);
  return { saves, editing, sync };
}

/** Lets everything waiting on the fake server's answers run. */
const settled = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Lyric Sheet editing, an Alternate's text", () => {
  it('saves 800 ms after the last keystroke', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThr');
    await vi.advanceTimersByTimeAsync(500);
    box.type('One\nTwo\nThree');
    await vi.advanceTimersByTimeAsync(799);
    expect(server.landed).toBe(0);
    expect(editing.unsavedIn(1)).toBe(true);
    expect(saves.unsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await settled();
    expect(server.landed).toBe(1);
    expect(textOf(server.song)).toBe('One\nTwo\nThree');
    expect(textOf(saves.song)).toBe('One\nTwo\nThree');
    expect(box.text).toBe('One\nTwo\nThree');
    expect(editing.unsavedIn(1)).toBe(false);
    expect(saves.unsaved).toBe(false);
  });

  it('saves at once on blur', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    box.blur();
    await settled();
    expect(textOf(server.song)).toBe('One\nTwo\nThree');
    expect(editing.unsavedIn(1)).toBe(false);
    await vi.advanceTimersByTimeAsync(800);
    expect(server.landed).toBe(1);
  });

  it('sends nothing on blur when the text is back as saved', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    box.type('One\nTwo');
    box.blur();
    await settled();
    expect(server.landed).toBe(0);
    expect(editing.unsavedIn(1)).toBe(false);
  });

  it('saves at once when the box closes, as leaving the page does without a blur', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    box.close();
    await settled();
    expect(textOf(server.song)).toBe('One\nTwo\nThree');
    expect(editing.unsavedIn(1)).toBe(false);
  });

  it('keeps the text after a failed save, shows the save error, and sends it again on the next keystroke', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    server.failNext(1);
    box.type('One\nTwo\nThree');
    await vi.advanceTimersByTimeAsync(800);
    expect(saves.saveError).toMatch(/Can't reach Bandmate/);
    expect(box.text).toBe('One\nTwo\nThree');
    expect(textOf(saves.song)).toBe('One\nTwo');
    expect(editing.unsavedIn(1)).toBe(true);
    // It isn't tried again by itself.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.landed).toBe(0);
    box.type('One\nTwo\nThree!');
    await vi.advanceTimersByTimeAsync(800);
    expect(textOf(server.song)).toBe('One\nTwo\nThree!');
    expect(saves.saveError).toBeNull();
    expect(editing.unsavedIn(1)).toBe(false);
  });

  it('sends a failed save again on blur, though the text is as it was', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    server.failNext(1);
    box.type('One\nTwo\nThree');
    await vi.advanceTimersByTimeAsync(800);
    expect(editing.unsavedIn(1)).toBe(true);
    box.blur();
    await settled();
    expect(textOf(server.song)).toBe('One\nTwo\nThree');
    expect(saves.saveError).toBeNull();
    expect(editing.unsavedIn(1)).toBe(false);
  });

  it("keeps its own text over the server's while a save is on its way, or failed", async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    // A Tag saved ahead of it, on its way, moves the Song on, its text as it was.
    const release = server.holdNextAnswer();
    const tagging = saves.setTags(['Live']);
    box.focus();
    box.type('Mine');
    box.blur();
    expect(box.text).toBe('Mine');
    release();
    await tagging;
    expect(textOf(saves.song)).toBe('One\nTwo');
    expect(box.text).toBe('Mine');
    await settled();
    expect(textOf(saves.song)).toBe('Mine');

    server.failNext(1);
    box.focus();
    box.type('Mine, failed');
    box.blur();
    await settled();
    expect(saves.saveError).not.toBeNull();
    expect(await saves.change((at) => server.update(at, { key: 'Am' }))).toBe(true);
    expect(textOf(saves.song)).toBe('Mine');
    expect(box.text).toBe('Mine, failed');
  });

  it("shows the server's text as it changes while the box holds nothing of its own", async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    expect(box.text).toBe('One\nTwo');
    server.changeElsewhere(withText(server.song, 'Uno\nDos'));
    await saves.refresh();
    expect(box.text).toBe('Uno\nDos');
  });
});

describe("Lyric Sheet editing, the Lyric Sheet's edits not saved yet", () => {
  it('stops counting a box closed on a failed save as unsaved once that save is over', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    server.failNext(2);
    box.type('One\nTwo\nThree');
    await vi.advanceTimersByTimeAsync(800);
    expect(editing.unsavedIn(1)).toBe(true);
    box.close();
    expect(editing.unsavedIn(1)).toBe(true);
    await settled();
    expect(server.landed).toBe(0);
    expect(saves.saveError).toMatch(/Can't reach Bandmate/);
    expect(editing.unsavedIn(1)).toBe(false);
    expect(saves.unsaved).toBe(false);
  });

  it('counts a Label, an Alternate name or a Cue time being typed as unsaved in its Section, until it saves', async () => {
    const server = new FakeSongServer(withBridge());
    const { saves, editing } = await editingFor(server);
    const label = editing.sectionLabel(1);
    label.shown = 'Chorus';
    expect(saves.unsaved).toBe(true);
    expect(editing.unsavedIn(1)).toBe(true);
    expect(editing.unsavedIn(2)).toBe(false);
    label.commit();
    await settled();
    expect(editing.unsavedIn(1)).toBe(false);
    expect(saves.unsaved).toBe(false);

    const name = editing.alternateName(2, 2);
    name.shown = 'Darker';
    expect(editing.unsavedIn(2)).toBe(true);
    name.cancel();
    expect(editing.unsavedIn(2)).toBe(false);

    // A Cue's time typed into a Section's Lines, as CueField types it.
    const cue = new TypedField<string>({
      saved: () => '0:12.0',
      format: (at) => at,
      parse: () => 'back',
      commit: () => {},
      typing: editing.typing,
      section: 2,
    });
    cue.shown = '0:1';
    expect(editing.unsavedIn(2)).toBe(true);
    expect(editing.unsavedIn(1)).toBe(false);
  });

  it("counts the edits typed into a Section's editor, Lines text and names alike, gone or not", async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    const label = editing.sectionLabel(1);
    label.shown = 'C';
    label.shown = 'Ch';
    expect(editing.typedIn(1)).toBe(3);
    expect(editing.typedIn(2)).toBe(0);
    expect(editing.unsavedIn(1)).toBe(true);
    // A field gone, e.g. as Alternates mode closes, still counts as typed in.
    label.destroy();
    box.close();
    await settled();
    expect(editing.typedIn(1)).toBe(3);
    expect(editing.unsavedIn(1)).toBe(false);
  });

  it('doesn’t count what’s saved shown again as typed, e.g. the Label’s Esc putting it back', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const label = editing.sectionLabel(1);
    label.shown = 'Chorus';
    expect(editing.typedIn(1)).toBe(1);
    // The Label's Combobox puts back what's saved, then cancels.
    label.shown = 'Verse';
    label.cancel();
    expect(editing.typedIn(1)).toBe(1);
  });

  it('marks the Song stale on a refresh while text waits to be saved, rather than replace it', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    server.changeElsewhere({ title: 'From another tab' });
    await saves.refresh();
    expect(saves.stale).toBe(true);
    expect(saves.song.title).toBe('Untitled');
    expect(box.text).toBe('One\nTwo\nThree');
  });

  it('marks the Song stale on a refresh while a Label is typed, rather than replace it', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const label = editing.sectionLabel(1);
    label.shown = 'Chorus';
    server.changeElsewhere({ title: 'From another tab' });
    await saves.refresh();
    expect(saves.stale).toBe(true);
    expect(label.shown).toBe('Chorus');
  });
});

describe("Lyric Sheet editing, a Section's Label", () => {
  it('saves the Label typed, trimmed, ending Sync mode', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing, sync } = await editingFor(server);
    const label = editing.sectionLabel(1);
    expect(label.shown).toBe('Verse');
    label.shown = ' Chorus ';
    label.commit();
    expect(sync.ended).toBe(1);
    await settled();
    expect(server.song.sections[0].label).toBe('Chorus');
    expect(saves.song.sections[0].label).toBe('Chorus');
    expect(label.shown).toBe('Chorus');
  });

  it('saves a blank Label, so the Section goes by its place again', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const label = editing.sectionLabel(1);
    label.shown = '  ';
    label.commit();
    await settled();
    expect(server.song.sections[0].label).toBe('');
  });

  it('does nothing when what’s typed is what’s saved', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing, sync } = await editingFor(server);
    const label = editing.sectionLabel(1);
    label.shown = 'Verse ';
    label.commit();
    await settled();
    expect(server.landed).toBe(0);
    expect(sync.ended).toBe(0);
    expect(label.shown).toBe('Verse');
  });

  it('shows what’s saved again once a save fails', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const label = editing.sectionLabel(1);
    server.failNext(1);
    label.shown = 'Chorus';
    label.commit();
    await settled();
    expect(saves.saveError).toMatch(/Can't reach Bandmate/);
    expect(label.shown).toBe('Verse');
    expect(saves.unsaved).toBe(false);
  });

  it('takes back what’s typed on cancel, e.g. Esc', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const label = editing.sectionLabel(1);
    label.shown = 'Chorus';
    label.cancel();
    expect(label.shown).toBe('Verse');
    expect(saves.unsaved).toBe(false);
    label.destroy();
    await settled();
    expect(server.landed).toBe(0);
  });

  it('saves what’s typed as its field goes', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const label = editing.sectionLabel(1);
    label.shown = 'Chorus';
    label.destroy();
    await settled();
    expect(server.song.sections[0].label).toBe('Chorus');
  });
});

describe("Lyric Sheet editing, an Alternate's name", () => {
  it('saves the name typed, trimmed, and a blank one removes it', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing, sync } = await editingFor(server);
    const name = editing.alternateName(1, 1);
    expect(name.shown).toBe('');
    name.shown = ' Darker ';
    name.commit();
    expect(sync.ended).toBe(1);
    await settled();
    expect(server.song.sections[0].alternates[0].name).toBe('Darker');
    expect(name.shown).toBe('Darker');
    name.shown = ' ';
    name.commit();
    await settled();
    expect(server.song.sections[0].alternates[0].name).toBe('');
  });

  it('does nothing when what’s typed is what’s saved', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const name = editing.alternateName(1, 1);
    name.shown = ' ';
    name.commit();
    await settled();
    expect(server.landed).toBe(0);
    expect(name.shown).toBe('');
  });

  it('shows what’s saved again once a save fails', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    const name = editing.alternateName(1, 1);
    server.failNext(1);
    name.shown = 'Darker';
    name.commit();
    await settled();
    expect(saves.saveError).toMatch(/Can't reach Bandmate/);
    expect(name.shown).toBe('');
  });

  it('takes back what’s typed on cancel, e.g. Esc, and saves what’s typed as its field goes', async () => {
    const server = new FakeSongServer(verseSong());
    const { editing } = await editingFor(server);
    const name = editing.alternateName(1, 1);
    name.shown = 'Darker';
    name.cancel();
    expect(name.shown).toBe('');
    name.destroy();
    await settled();
    expect(server.landed).toBe(0);
    name.shown = 'Brighter';
    name.destroy();
    await settled();
    expect(server.song.sections[0].alternates[0].name).toBe('Brighter');
  });
});

/** The Verse in the Arrangement, as verseSong has it, and the Bridge in the Scrapbook, of one Alternate, Lines 20 and 21. */
const withBridge = () => {
  const song = verseSong();
  const bridge = {
    id: 2,
    label: 'Bridge',
    alternates: [
      {
        id: 2,
        name: '',
        active: true,
        lines: [
          { id: 20, text: 'Up', lyrics: 'Up', chords: [], chordLine: false, cue: null },
          { id: 21, text: 'Down', lyrics: 'Down', chords: [], chordLine: false, cue: 12 },
        ],
      },
    ],
  };
  return { ...song, sections: [...song.sections, bridge], scrapbook: [2] };
};

describe('Lyric Sheet editing, the structure of the Lyric Sheet', () => {
  it('adds a Section to the Arrangement, which a caller awaiting it finds there', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    expect(await editing.change({ kind: 'addSection', position: 0 })).toBe(true);
    const added = saves.song.arrangement[0];
    expect(saves.song.arrangement).toEqual([added, 1]);
    expect(server.song.arrangement).toEqual([added, 1]);
    const section = saves.song.sections.find((s) => s.id === added)!;
    expect(section.label).toBe('');
    expect(section.alternates).toHaveLength(1);
    expect(section.alternates[0].active).toBe(true);
  });

  it('takes a Section out of the Arrangement to the Scrapbook, or deletes it if nothing is written in it', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    await editing.change({ kind: 'addSection' });
    const empty = saves.song.arrangement[1];
    expect(await editing.change({ kind: 'removeFromArrangement', sectionId: empty })).toBe(true);
    expect(saves.song.sections.map((s) => s.id)).toEqual([1]);
    expect(saves.song.scrapbook).toEqual([]);
    expect(await editing.change({ kind: 'removeFromArrangement', sectionId: 1 })).toBe(true);
    expect(saves.song.arrangement).toEqual([]);
    expect(saves.song.scrapbook).toEqual([1]);
  });

  it("adds a Section to another, its Alternates joining the other's, inactive, named by its Label", async () => {
    const server = new FakeSongServer(withBridge());
    const { saves, editing } = await editingFor(server);
    expect(await editing.change({ kind: 'addToSection', sectionId: 2, targetId: 1 })).toBe(true);
    expect(saves.song.scrapbook).toEqual([]);
    expect(saves.song.sections.map((s) => s.id)).toEqual([1]);
    const [own, joined] = saves.song.sections[0].alternates;
    expect(own.active).toBe(true);
    expect(joined).toMatchObject({ name: 'Bridge', active: false });
    expect(joined.id).not.toBe(2);
    expect(joined.lines.map((l) => [l.id, l.text, l.cue])).toEqual([
      [20, 'Up', null],
      [21, 'Down', 12],
    ]);
  });

  it('fails a change the fake leaves out as not modelled', async () => {
    const server = new FakeSongServer(verseSong());
    const { saves, editing } = await editingFor(server);
    expect(await editing.change({ kind: 'addAlternate', sectionId: 1 })).toBe(false);
    expect(saves.saveError).toMatch(/addAlternate is not modelled/);
  });
});

describe('Lyric Sheet editing, Sync mode', () => {
  // Every change the GLOSSARY says ends Sync mode: to the Arrangement or a
  // Section, moving a Section or an Alternate between the Scrapbook and the
  // Arrangement, and adding a Section in the Scrapbook.
  const ending: LyricSheetChange[] = [
    { kind: 'addSection' },
    { kind: 'duplicateSection', sectionId: 1 },
    { kind: 'reorderArrangement', order: [1] },
    { kind: 'removeFromArrangement', sectionId: 1 },
    { kind: 'addToSection', sectionId: 2, targetId: 1 },
    { kind: 'setSectionLabel', sectionId: 1, label: 'Chorus' },
    { kind: 'addAlternate', sectionId: 1 },
    { kind: 'renameAlternate', alternateId: 1, name: 'Darker' },
    { kind: 'activateAlternate', alternateId: 1 },
    { kind: 'deleteAlternate', alternateId: 1 },
    { kind: 'moveAlternateToScrapbook', alternateId: 1 },
    { kind: 'moveAlternateToArrangement', alternateId: 1, position: 0 },
    { kind: 'addToScrapbook' },
    { kind: 'addToArrangement', sectionId: 2, position: 0 },
  ];

  it.each(ending.map((c) => [c.kind, c] as const))('ends it as %s is asked for', async (_, change) => {
    const server = new FakeSongServer(withBridge());
    const { editing, sync } = await editingFor(server);
    const changing = editing.change(change);
    expect(sync.ended).toBe(1);
    await changing;
  });

  it('leaves it on for deleting a Scrapbook Section, a text save, or a Cue change', async () => {
    const server = new FakeSongServer(withBridge());
    const { saves, editing, sync } = await editingFor(server);
    expect(await editing.change({ kind: 'deleteSection', sectionId: 2 })).toBe(true);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    box.blur();
    await settled();
    expect(await saves.cue({ kind: 'setLineCue', lineId: 10, cue: 1 }, 'the Cue of Line 1 of Verse')).toBe(true);
    expect(sync.ended).toBe(0);
    expect(server.song.sections.map((s) => s.id)).toEqual([1]);
    expect(textOf(server.song)).toBe('One\nTwo\nThree');
  });

  it('ends it as a Scrapbook Section or Alternates mode opens', async () => {
    const server = new FakeSongServer(withBridge());
    const { editing, sync } = await editingFor(server);
    editing.scrapbookSectionOpened();
    expect(sync.ended).toBe(1);
    editing.alternatesOpened();
    expect(sync.ended).toBe(2);
    expect(server.landed).toBe(0);
  });
});

describe('Lyric Sheet editing, saving waiting text first', () => {
  it('sends the Lines text still waiting in a Section before adding it to another, in order', async () => {
    const server = new FakeSongServer(withBridge());
    const { saves, editing } = await editingFor(server);
    const box = editing.textBox(2, 2);
    box.focus();
    box.type('Up\nDown\nAround');
    // No blur: a drag by the grip leaves the text box focused.
    expect(await editing.change({ kind: 'addToSection', sectionId: 2, targetId: 1 })).toBe(true);
    expect(server.landed).toBe(2);
    const joined = server.song.sections[0].alternates[1];
    expect(joined.lines.map((l) => l.text)).toEqual(['Up', 'Down', 'Around']);
    expect(saves.saveError).toBeNull();
    // Nothing is sent again as typing's pause comes round, or as the box closes.
    box.close();
    await vi.advanceTimersByTimeAsync(800);
    expect(server.landed).toBe(2);
    expect(editing.unsavedIn(2)).toBe(false);
  });

  it('sends a failed save in the Section again before adding it to another', async () => {
    const server = new FakeSongServer(withBridge());
    const { editing } = await editingFor(server);
    const box = editing.textBox(2, 2);
    box.focus();
    server.failNext(1);
    box.type('Up\nDown\nAround');
    await vi.advanceTimersByTimeAsync(800);
    expect(server.landed).toBe(0);
    expect(await editing.change({ kind: 'addToSection', sectionId: 2, targetId: 1 })).toBe(true);
    const joined = server.song.sections[0].alternates[1];
    expect(joined.lines.map((l) => l.text)).toEqual(['Up', 'Down', 'Around']);
  });

  it("leaves text waiting in another Section's box to save as it would", async () => {
    const server = new FakeSongServer(withBridge());
    const { editing } = await editingFor(server);
    const box = editing.textBox(1, 1);
    box.focus();
    box.type('One\nTwo\nThree');
    expect(await editing.change({ kind: 'addToSection', sectionId: 2, targetId: 1 })).toBe(true);
    expect(server.landed).toBe(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(server.landed).toBe(2);
    expect(textOf(server.song)).toBe('One\nTwo\nThree');
  });
});
