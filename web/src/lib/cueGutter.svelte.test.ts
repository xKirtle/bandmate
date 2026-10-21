import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Line, Section, Song } from './api';
import type { CueChange } from './cueChanges';
import { CueGutter } from './cueGutter.svelte';
import { emptySong } from './songServerFake';
import { storage } from './storageFake';
import { SyncMode, type SyncPort } from './syncMode.svelte';

/** A Line of words, with whatever of it the test cares about. */
const line = (id: number, fields: Partial<Line> = {}): Line => ({
  id,
  text: `Line ${id}`,
  lyrics: `Line ${id}`,
  chords: [],
  chordLine: false,
  cue: null,
  ...fields,
});

/** A Section of one active Alternate holding the Lines given. */
const section = (id: number, label: string, lines: Line[]): Section => ({
  id,
  label,
  alternates: [{ id, name: '', active: true, lines }],
});

/** A Song of two Sections in the Arrangement: the Verse's Lines 10 to 12, then the Chorus's 20 and 21. */
const sheetSong = (verse = [line(10), line(11), line(12)], chorus = [line(20), line(21)]): Song =>
  emptySong({ arrangement: [1, 2], sections: [section(1, 'Verse', verse), section(2, 'Chorus', chorus)] });

/** The Timeline as Sync mode sees it: playing, with a Clip, the Loop off. */
class FakePort implements SyncPort {
  loopOn = $state(false);
  recording = $state(false);
  hasClips = $state(true);
  playhead = 0;
  stopLoop() {
    this.loopOn = false;
  }
  playheadAt() {
    return this.playhead;
  }
}

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const d of disposers.splice(0)) d();
});

/**
 * The gutter as the Lyric Sheet makes it, inside an effect root, on the Song
 * given, in Write mode on a wide window with a Clip on the Timeline, beside
 * the Sync mode of the same page. The test changes the page through `page`,
 * reads the Cue changes made off `cues`, and the fields it registers record
 * which of them was opened in `opened`.
 */
function gutterFor(song: Song) {
  const page = $state<{ song: Song; wide: boolean; hasClips: boolean; playFrom: ((at: number) => void) | undefined }>({
    song,
    wide: true,
    hasClips: true,
    playFrom: undefined,
  });
  const cues: { change: CueChange; what: string }[] = [];
  const cue = (change: CueChange, what: string) => {
    cues.push({ change, what });
    return Promise.resolve(true);
  };
  const opened: number[] = [];
  const port = new FakePort();
  let sync!: SyncMode;
  let gutter!: CueGutter;
  disposers.push(
    $effect.root(() => {
      sync = new SyncMode({
        mode: () => 'write',
        wide: () => page.wide,
        song: () => page.song,
        cue,
        storage: storage(),
      });
      gutter = new CueGutter({
        song: () => page.song,
        wide: () => page.wide,
        hasClips: () => page.hasClips,
        cue,
        playFrom: () => page.playFrom,
        sync,
      });
    }),
  );
  disposers.push(sync.attach(port));
  flushSync();
  /** Draws the Cue field of each Line given, as the gutter does. */
  const draw = (...lines: number[]) => {
    for (const id of lines) gutter.field(id, { edit: () => opened.push(id) });
  };
  return { gutter, sync, port, page, cues, opened, draw };
}

describe('going on to the next Cue field', () => {
  it('opens the next field down the page, across Sections', () => {
    const { gutter, opened, draw } = gutterFor(sheetSong());
    draw(10, 11, 12, 20, 21);
    expect(gutter.editAfter(12)).toBe(true);
    expect(opened).toEqual([20]);
  });

  it('skips a Line with no field just now', () => {
    const { gutter, opened, draw } = gutterFor(sheetSong());
    draw(10, 12);
    expect(gutter.editAfter(10)).toBe(true);
    expect(opened).toEqual([12]);
  });

  it('answers that there was none after the last field', () => {
    const { gutter, opened, draw } = gutterFor(sheetSong());
    draw(10, 11, 12, 20, 21);
    expect(gutter.editAfter(21)).toBe(false);
    expect(opened).toEqual([]);
  });

  it('forgets a field once its Line is gone', () => {
    const { gutter, opened, draw } = gutterFor(sheetSong());
    draw(10, 11);
    gutter.field(11, null);
    expect(gutter.editAfter(10)).toBe(false);
    expect(opened).toEqual([]);
  });

  it('leaves out a blank Line, which has no field', () => {
    const { gutter, opened, draw } = gutterFor(sheetSong([line(10), line(11, { text: '  ', lyrics: '  ' }), line(12)]));
    draw(10, 11, 12);
    expect(gutter.editAfter(10)).toBe(true);
    expect(opened).toEqual([12]);
  });
});

describe('whether the gutter is offered', () => {
  it('is offered on a wide window with a Clip to cue to', () => {
    const { gutter } = gutterFor(sheetSong());
    expect(gutter.offered).toBe(true);
  });

  it('is not offered on a narrow window', () => {
    const { gutter, page } = gutterFor(sheetSong());
    page.wide = false;
    flushSync();
    expect(gutter.offered).toBe(false);
  });

  it('is not offered without a Clip to cue to and no Cue set', () => {
    const { gutter, page } = gutterFor(sheetSong());
    page.hasClips = false;
    flushSync();
    expect(gutter.offered).toBe(false);
  });

  it('is offered without a Clip once a Cue is already set', () => {
    const { gutter, page } = gutterFor(sheetSong());
    page.hasClips = false;
    page.song = sheetSong([line(10, { cue: 3 }), line(11), line(12)]);
    flushSync();
    expect(gutter.offered).toBe(true);
  });
});

describe('what the gutter says about a Line', () => {
  it("ends a Line's name suffix with its Section's Label", () => {
    const { gutter } = gutterFor(sheetSong());
    expect(gutter.labelSuffix(1)).toBe(' of Verse');
    expect(gutter.labelSuffix(2)).toBe(' of Chorus');
  });

  it('has no suffix for a Section with no Label', () => {
    const { gutter, page } = gutterFor(sheetSong());
    page.song = emptySong({ arrangement: [1], sections: [section(1, '', [line(10)])] });
    flushSync();
    expect(gutter.labelSuffix(1)).toBe('');
  });

  it('says why a Cue is out of order, naming the Line it clashes with', () => {
    const { gutter } = gutterFor(sheetSong([line(10, { cue: 5 }), line(11, { cue: 1 }), line(12)]));
    expect(gutter.outOfOrder(11)).toBe('Earlier than Line 1 of Verse (0:05.0)');
    expect(gutter.outOfOrder(10)).toBe('Later than Line 2 of Verse (0:01.0)');
    expect(gutter.outOfOrder(12)).toBeNull();
  });

  it('answers whether a Line is still in the Song', () => {
    const { gutter, page } = gutterFor(sheetSong());
    expect(gutter.has(10)).toBe(true);
    expect(gutter.has(99)).toBe(false);
    page.song = sheetSong([line(11), line(12)]);
    flushSync();
    expect(gutter.has(10)).toBe(false);
  });
});

describe("changing a Line's Cue", () => {
  it("saves a Line's Cue, naming the Line", () => {
    const { gutter, cues } = gutterFor(sheetSong());
    gutter.save({ section: 1, line: 11 }, 12.5);
    expect(cues).toEqual([
      { change: { kind: 'setLineCue', lineId: 11, cue: 12.5 }, what: 'the Cue of Line 2 of Verse' },
    ]);
  });

  it("clears a Line's Cue", () => {
    const { gutter, cues } = gutterFor(sheetSong());
    gutter.save({ section: 2, line: 20 }, null);
    expect(cues).toEqual([
      { change: { kind: 'setLineCue', lineId: 20, cue: null }, what: 'the Cue of Line 1 of Chorus' },
    ]);
  });
});

describe('playing from a Cue', () => {
  it('leads into the Cue by a second', () => {
    const { gutter, page } = gutterFor(sheetSong());
    const played: number[] = [];
    page.playFrom = (at) => played.push(at);
    flushSync();
    gutter.play?.(5);
    expect(played).toEqual([4]);
  });

  it("offers no ▶ while the Timeline can't play", () => {
    const { gutter } = gutterFor(sheetSong());
    expect(gutter.play).toBeUndefined();
  });
});

describe('in Sync mode', () => {
  /** Switches Sync mode on, as clicking Sync lyrics does. */
  const switchOn = (sync: SyncMode) => {
    sync.switch();
    flushSync();
  };

  it('marks the first Line without a Cue as the one up next', () => {
    const { gutter, sync } = gutterFor(sheetSong());
    expect(gutter.syncing).toBe(false);
    switchOn(sync);
    expect(gutter.syncing).toBe(true);
    expect(gutter.upNext).toBe(10);
  });

  it('makes a Line picked the one up next', () => {
    const { gutter, sync } = gutterFor(sheetSong());
    switchOn(sync);
    gutter.pick({ section: 2, line: 21 });
    flushSync();
    expect(gutter.upNext).toBe(21);
  });

  it('never picks a Chord Line', () => {
    const { gutter, sync } = gutterFor(sheetSong([line(10), line(11, { chordLine: true }), line(12)]));
    switchOn(sync);
    expect(gutter.pickable(11)).toBe(false);
    expect(gutter.pickable(12)).toBe(true);
    gutter.pick({ section: 1, line: 11 });
    flushSync();
    expect(gutter.upNext).toBe(10);
  });

  it('never picks a blank Line', () => {
    const { gutter, sync } = gutterFor(sheetSong([line(10), line(11, { text: '', lyrics: '' })]));
    switchOn(sync);
    expect(gutter.pickable(11)).toBe(false);
  });

  it('cues the Line up next at the playhead', () => {
    const { gutter, sync, port, cues } = gutterFor(sheetSong());
    switchOn(sync);
    port.playhead = 7.5;
    gutter.now();
    expect(cues).toEqual([
      { change: { kind: 'setLineCue', lineId: 10, cue: 7.5 }, what: 'the Cue of Line 1 of Verse' },
    ]);
  });
});
