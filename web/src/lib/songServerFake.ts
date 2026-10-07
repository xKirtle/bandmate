// An in-memory SongServer, for testing Saves, and Lyric Sheet editing on top
// of it, without the api: one Song and its Timeline, sharing a version, as
// the server keeps them.
import {
  ApiError,
  type Captured,
  type Clip,
  type ClipMove,
  type NewClip,
  type OwnOfClip,
  type Section,
  type Song,
  type SongAt,
  type Take,
  type TakePlacement,
  type Timeline,
  type Track,
} from './api';
import { withCueChange, type CueChange } from './cueChanges';
import { linesByRow } from './cues';
import type { Edit } from './history';
import { isLyricSheetChange, type LyricSheetChange } from './lyricSheetChanges';
import { peaksPerSecond } from './peaks';
import { isEmpty } from './sections';
import { isCueChange, type SongServer } from './songServer';

/** A failure as the network gives it. */
export const networkError = () => new ApiError(0, "Can't reach Bandmate. Check your connection.");

const staleError = () => new ApiError(409, 'The Song changed elsewhere', 'stale');

/** A Song with no Lines, Masters or Tags, at version 1. */
export function emptySong(fields: Partial<Song> = {}): Song {
  return {
    id: 1,
    version: 1,
    title: 'Untitled',
    status: 'idea',
    key: '',
    bpm: null,
    capo: null,
    tuning: '',
    notes: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    arrangement: [],
    sections: [],
    scrapbook: [],
    masters: [],
    cover: null,
    tags: [],
    ...fields,
  };
}

/**
 * The server, holding one Song and its Timeline. It refuses a write based
 * on a version that isn't current as stale, and can be made to fail the
 * next writes, lose the next answer (making the write, then failing on the
 * network), change the Song elsewhere, and hold an answer until released.
 *
 * Saves makes its own writes through `apply` and `setTags`, `apply` taking
 * Cue changes, Timeline edits and Lyric Sheet changes. Writes a
 * caller brings, as the Song page's panels make through the api, are made
 * here with `update` and `remove`, a Take's upload with `recordTake` and
 * `retake`, or for the Timeline, e.g. a Merge, with `apply`.
 */
export class FakeSongServer implements SongServer {
  song: Song;
  timeline: Timeline;
  /** How many writes landed, each one a write the server made. */
  landed = 0;
  /** The Song as deleted, once it is. */
  deleted = false;
  #failing: (() => Error)[] = [];
  #losing = 0;
  #holding: Promise<void> | null = null;

  /** The ids the next Section, Alternate, Line, Clip, Track and Take made get. */
  #nextSectionId = 1;
  #nextAlternateId = 1;
  #nextLineId = 1;
  #nextClipId = 1;
  #nextTrackId = 1;
  #nextTakeId = 1;

  /** Holds the Song given, and a Timeline of the Tracks given, by default none. */
  constructor(song: Song = emptySong(), tracks: Track[] = []) {
    this.song = structuredClone(song);
    this.timeline = {
      songId: song.id,
      version: song.version,
      updatedAt: song.updatedAt,
      tracks: structuredClone(tracks),
      beats: [],
      sounds: [],
      loop: null,
    };
    this.#nextSectionId = Math.max(0, ...song.sections.map((s) => s.id)) + 1;
    this.#nextAlternateId = Math.max(0, ...song.sections.flatMap((s) => s.alternates.map((a) => a.id))) + 1;
    const lineIds = song.sections.flatMap((s) => s.alternates.flatMap((a) => a.lines.map((l) => l.id)));
    this.#nextLineId = Math.max(0, ...lineIds) + 1;
    const ids = tracks.flatMap((t) => t.clips.map((c) => c.id));
    this.#nextClipId = Math.max(0, ...ids) + 1;
    this.#nextTrackId = Math.max(0, ...tracks.map((t) => t.id)) + 1;
    const takeIds = tracks.flatMap((t) => t.clips.flatMap((c) => c.takes.map((k) => k.id)));
    this.#nextTakeId = Math.max(0, ...takeIds) + 1;
  }

  /** Fails the next writes, n of them, before they're made, by default on the network. */
  failNext(n: number, error: () => Error = networkError) {
    for (let i = 0; i < n; i++) this.#failing.push(error);
  }

  /** Makes the next write, then fails it on the network, as if its answer was lost. */
  loseNextAnswer() {
    this.#losing++;
  }

  /**
   * Holds the answer to the next write, made at once, until the function
   * returned is called.
   */
  holdNextAnswer(): () => void {
    let release!: () => void;
    this.#holding = new Promise((done) => (release = done));
    return release;
  }

  /** Changes the Song elsewhere, e.g. in another tab, moving it on a version. */
  changeElsewhere(changes: Partial<Song> = {}) {
    this.#moveOn();
    this.song = { ...this.song, ...structuredClone(changes) };
  }

  getSong(): Promise<Song> {
    return Promise.resolve(structuredClone(this.song));
  }

  getTimeline(): Promise<Timeline> {
    return Promise.resolve(structuredClone(this.timeline));
  }

  apply(at: SongAt, change: CueChange): Promise<Song>;
  apply(at: SongAt, change: LyricSheetChange): Promise<Song>;
  apply(at: SongAt, edit: Edit): Promise<Timeline>;
  apply(at: SongAt, change: CueChange | LyricSheetChange | Edit): Promise<Song | Timeline> {
    if (isCueChange(change)) {
      return this.#write(at, () => {
        this.song = withCueChange(this.song, change);
        return structuredClone(this.song);
      });
    }
    if (isLyricSheetChange(change)) {
      let after: (song: Song) => Song;
      try {
        after = this.#changed(change);
      } catch (e) {
        return Promise.reject(e);
      }
      return this.#write(at, () => {
        this.song = after(this.song);
        return structuredClone(this.song);
      });
    }
    let after: (tl: Timeline) => Timeline;
    try {
      after = this.#edited(change);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.#write(at, () => {
      this.timeline = after(this.timeline);
      return structuredClone(this.timeline);
    });
  }

  /**
   * What a Timeline edit does, for the edits the fake models: the Loop's,
   * adding, changing and deleting a Track, and placing, pasting, moving,
   * splitting, setting the Gain of and deleting Clips of a Beat or a Sound
   * on the Tracks there are. Others throw "not modelled".
   */
  #edited(edit: Edit): (tl: Timeline) => Timeline {
    const place = (tl: Timeline, trackId: number, clip: NewClip) =>
      withClips(tl, trackId, (cs) => [...cs, this.#clip(clip)]);
    const withoutClips = (tl: Timeline, ids: number[]) => ({
      ...tl,
      tracks: tl.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.includes(c.id)) })),
    });
    switch (edit.kind) {
      case 'setLoop':
        return (tl) => ({ ...tl, loop: { ...edit.loop } });
      case 'switchLoop':
        return (tl) => ({ ...tl, loop: tl.loop && { ...tl.loop, on: edit.on } });
      case 'clearLoop':
        return (tl) => ({ ...tl, loop: null });
      case 'addTrack':
        return (tl) => {
          const { name } = edit.track;
          const track: Track = { id: this.#nextTrackId++, name, volume: 0, muted: false, soloed: false, clips: [] };
          return { ...tl, tracks: [...tl.tracks, track] };
        };
      case 'updateTrack':
        return (tl) => ({
          ...tl,
          tracks: tl.tracks.map((t) => (t.id === edit.trackId ? { ...t, ...edit.changes } : t)),
        });
      case 'deleteTrack':
        return (tl) => ({ ...tl, tracks: tl.tracks.filter((t) => t.id !== edit.trackId) });
      case 'placeClip':
        return (tl) => place(tl, edit.trackId, edit.clip);
      case 'placeClips':
      case 'replaceClips': {
        if (edit.newTracks || ('trackIds' in edit && edit.trackIds)) throw notModelled(edit);
        const placed = edit.clips.map((c) => {
          if (!('trackId' in c)) throw notModelled(edit);
          return c;
        });
        const replaced = edit.kind === 'replaceClips' ? edit.clipIds : [];
        return (tl) => placed.reduce((t, c) => place(t, c.trackId, c.clip), withoutClips(tl, replaced));
      }
      case 'pasteClips': {
        if (edit.newTracks.length > 0) throw notModelled(edit);
        const pasted = edit.clips.map((c) => {
          if (!('trackId' in c) || 'takes' in c.clip) throw notModelled(edit);
          return { trackId: c.trackId, clip: c.clip as NewClip };
        });
        return (tl) => pasted.reduce((t, c) => place(t, c.trackId, c.clip), tl);
      }
      case 'splitClips':
        // Each Clip keeps its id as its left half; its right half is a new
        // Clip. Fades and Takes aren't modelled.
        return (tl) => ({
          ...tl,
          tracks: tl.tracks.map((t) => ({
            ...t,
            clips: t.clips.flatMap((c) => {
              if (!edit.clipIds.includes(c.id)) return [c];
              const cut = edit.at - c.start;
              const right = this.#clip({
                ...sourceOf(c),
                start: edit.at,
                offset: c.offset + cut,
                length: c.length - cut,
              });
              return [{ ...c, length: cut }, right];
            }),
          })),
        });
      case 'moveClip':
        return (tl) => moved(tl, edit);
      case 'moveClips':
        return (tl) => edit.moves.reduce(moved, tl);
      case 'setClipGain':
        return (tl) => ({
          ...tl,
          tracks: tl.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => (c.id === edit.clipId ? { ...c, gain: edit.gain } : c)),
          })),
        });
      case 'deleteClip':
        return (tl) => withoutClips(tl, [edit.clipId]);
      case 'deleteClips':
        if (edit.trackIds) throw notModelled(edit);
        return (tl) => withoutClips(tl, edit.clipIds);
      default:
        throw notModelled(edit);
    }
  }

  /**
   * What a Lyric Sheet change does, for the changes the fake models: adding
   * a Section to the Arrangement, taking one out of it, deleting one in the
   * Scrapbook, adding one to another, and replacing an Alternate's text.
   * Others throw "not modelled".
   */
  #changed(change: LyricSheetChange): (song: Song) => Song {
    switch (change.kind) {
      case 'addSection':
        return (song) => {
          const section: Section = {
            id: this.#nextSectionId++,
            label: '',
            alternates: [{ id: this.#nextAlternateId++, name: '', active: true, lines: [] }],
          };
          const arrangement = [...song.arrangement];
          arrangement.splice(change.position ?? arrangement.length, 0, section.id);
          return { ...song, arrangement, sections: [...song.sections, section] };
        };
      case 'removeFromArrangement':
        // It goes to the end of the Scrapbook, or is deleted if nothing is written in it.
        return (song) => {
          const arrangement = song.arrangement.filter((id) => id !== change.sectionId);
          const section = song.sections.find((s) => s.id === change.sectionId)!;
          if (isEmpty(section)) return withoutSection({ ...song, arrangement }, section.id);
          return { ...song, arrangement, scrapbook: [...song.scrapbook, section.id] };
        };
      case 'deleteSection':
        return (song) => withoutSection(song, change.sectionId);
      case 'addToSection':
        // Each of its Alternates is made anew, inactive, after the Section's
        // own, an unnamed one taking its Label as its name; their Lines keep
        // their ids and Cues.
        return (song) => {
          const added = song.sections.find((s) => s.id === change.sectionId)!;
          const joining = added.alternates.map((a) => ({
            ...a,
            id: this.#nextAlternateId++,
            name: a.name || added.label,
            active: false,
          }));
          const sections = song.sections.map((s) =>
            s.id === change.targetId ? { ...s, alternates: [...s.alternates, ...joining] } : s,
          );
          return withoutSection({ ...song, sections }, added.id);
        };
      case 'replaceAlternateText':
        return (song) => this.#withText(song, change.alternateId, change.text);
      default:
        throw notModelled(change);
    }
  }

  /**
   * An Alternate's text replaced: a Line of each row, keeping the Line, and
   * its Cue, of each row matched to one as the text box matches them. Its
   * Chords aren't read.
   */
  #withText(song: Song, alternateId: number, text: string): Song {
    const sections = song.sections.map((s) => ({
      ...s,
      alternates: s.alternates.map((a) => {
        if (a.id !== alternateId) return a;
        const rows = text.split('\n');
        const lines = linesByRow(text, a.lines).map((line, i) => ({
          id: line?.id ?? this.#nextLineId++,
          text: rows[i],
          lyrics: rows[i],
          chords: [],
          chordLine: false,
          cue: line?.cue ?? null,
        }));
        return { ...a, lines };
      }),
    }));
    return { ...song, sections };
  }

  /** A Clip placed, with the next id. */
  #clip(placed: NewClip): Clip {
    const { start, offset, length } = placed;
    return {
      id: this.#nextClipId++,
      beatId: 'beatId' in placed ? placed.beatId : null,
      soundId: 'soundId' in placed ? placed.soundId : null,
      name: placed.name ?? null,
      gain: placed.gain ?? 0,
      fadeIn: placed.fadeIn ?? 0,
      fadeOut: placed.fadeOut ?? 0,
      takes: [],
      activeTakeId: null,
      start,
      offset,
      length,
    };
  }

  /**
   * Places a Take just recorded in a new Clip, as the api's recordTake
   * does: the Clip runs from start to where the Take ends, as long as its
   * peaks say, and its Take starts where it was heard.
   */
  recordTake(at: SongAt, wav: Blob, placement: TakePlacement): Promise<Timeline> {
    const { trackId, start, ...captured } = placement;
    const heard = captured.captureStart - captured.latencyOffset;
    return this.#write(at, () => {
      const take = this.#take(captured, 0);
      // A Clip of Takes plays no Sound.
      const placed = this.#clip({ soundId: 0, start, offset: start - heard, length: heard + take.duration - start });
      const clip: Clip = { ...placed, soundId: null, takes: [take], activeTakeId: take.id };
      this.timeline = withClips(this.timeline, trackId, (cs) => [...cs, clip]);
      return structuredClone(this.timeline);
    });
  }

  /** Records a Take into a Clip of Takes, as its active Take, as the api's retake does, leaving the Clip's length as it is. */
  retake(at: SongAt, clipId: number, wav: Blob, captured: Captured): Promise<Timeline> {
    return this.#write(at, () => {
      const track = this.timeline.tracks.find((t) => t.clips.some((c) => c.id === clipId))!;
      this.timeline = withClips(this.timeline, track.id, (cs) =>
        cs.map((c) => {
          if (c.id !== clipId) return c;
          const take = this.#take(captured, captured.captureStart - captured.latencyOffset - (c.start - c.offset));
          return { ...c, takes: [...c.takes, take], activeTakeId: take.id };
        }),
      );
      return structuredClone(this.timeline);
    });
  }

  /** A Take uploaded, lasting as long as its peaks say, at a position in its Clip's span. */
  #take({ latencyOffset, peaks }: Captured, position: number): Take {
    const id = this.#nextTakeId++;
    const duration = peaks.length / peaksPerSecond;
    return { id, number: id, size: 0, duration, sampleRate: 0, latencyOffset, position, nudge: 0, recordedAt: '' };
  }

  setTags(tags: string[]): Promise<string[]> {
    return this.#write(null, () => {
      this.song = { ...this.song, tags: [...new Set(tags)] };
      return [...this.song.tags];
    });
  }

  /** Changes the Song's Details, as the api's updateSong does. */
  update(at: SongAt, changes: Partial<Song>): Promise<Song> {
    return this.#write(at, () => {
      this.song = { ...this.song, ...structuredClone(changes) };
      return structuredClone(this.song);
    });
  }

  /** Deletes the Song, as the api's deleteSong does. */
  remove(at: SongAt): Promise<null> {
    return this.#write(at, () => {
      this.deleted = true;
      return null;
    });
  }

  /**
   * A write, based on the version given, or on none for one that leaves
   * the version as it was.
   */
  #write<T>(at: SongAt | null, make: () => T): Promise<T> {
    const failure = this.#failing.shift();
    if (failure) return Promise.reject(failure());
    if (this.deleted) return Promise.reject(new ApiError(404, 'Song not found'));
    if (at && at.version !== this.song.version) return Promise.reject(staleError());
    if (at) this.#moveOn();
    const made = make();
    this.landed++;
    const lost = this.#losing > 0;
    if (lost) this.#losing--;
    const answer = (): Promise<T> => (lost ? Promise.reject(networkError()) : Promise.resolve(made));
    const holding = this.#holding;
    this.#holding = null;
    return holding ? holding.then(answer) : answer();
  }

  #moveOn() {
    const version = this.song.version + 1;
    const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, version)).toISOString();
    this.song = { ...this.song, version, updatedAt };
    this.timeline = { ...this.timeline, version, updatedAt };
  }
}

const notModelled = (change: Edit | LyricSheetChange) => new Error(`${change.kind} is not modelled`);

/** What a Clip of a Beat or a Sound plays, and its own name and Gain, to place a Clip of the same. */
function sourceOf(clip: Clip): OwnOfClip & ({ beatId: number } | { soundId: number }) {
  const own = { name: clip.name ?? undefined, gain: clip.gain };
  return clip.beatId !== null ? { ...own, beatId: clip.beatId } : { ...own, soundId: clip.soundId! };
}

/** A Timeline with a Clip moved to a Track and a start. */
function moved(tl: Timeline, move: ClipMove): Timeline {
  const clip = tl.tracks.flatMap((t) => t.clips).find((c) => c.id === move.clipId)!;
  const without = {
    ...tl,
    tracks: tl.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clip.id) })),
  };
  return withClips(without, move.trackId, (cs) => [...cs, { ...clip, start: move.start }]);
}

/** A Song without a Section, wherever it was. */
function withoutSection(song: Song, sectionId: number): Song {
  return {
    ...song,
    arrangement: song.arrangement.filter((id) => id !== sectionId),
    scrapbook: song.scrapbook.filter((id) => id !== sectionId),
    sections: song.sections.filter((s) => s.id !== sectionId),
  };
}

/** A Timeline with one Track's Clips changed, kept in the order they start. */
function withClips(tl: Timeline, trackId: number, change: (clips: Clip[]) => Clip[]): Timeline {
  return {
    ...tl,
    tracks: tl.tracks.map((t) =>
      t.id === trackId ? { ...t, clips: change(t.clips).sort((a, b) => a.start - b.start) } : t,
    ),
  };
}
