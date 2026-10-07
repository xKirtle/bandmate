// An in-memory SongServer, for testing Saves without the api: one Song and
// its Timeline, sharing a version, as the server keeps them.
import { ApiError, type Clip, type NewClip, type Song, type SongAt, type Timeline, type Track } from './api';
import { withCueChange, type CueChange } from './cueChanges';
import type { Edit } from './history';
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
 * Saves makes its own writes through `apply` and `setTags`. Writes a
 * caller brings, as the Song page's panels make through the api, are made
 * here with `update` and `remove`, or for the Timeline, e.g. a Take's
 * upload or a Merge, with `apply`.
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

  /** The id the next Clip placed gets. */
  #nextClipId = 1;

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
    const ids = tracks.flatMap((t) => t.clips.map((c) => c.id));
    this.#nextClipId = Math.max(0, ...ids) + 1;
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
  apply(at: SongAt, edit: Edit): Promise<Timeline>;
  apply(at: SongAt, change: CueChange | Edit): Promise<Song | Timeline> {
    if (isCueChange(change)) {
      return this.#write(at, () => {
        this.song = withCueChange(this.song, change);
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
   * and placing, moving and deleting Clips on the Tracks there are. Others
   * throw "not modelled".
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
      case 'moveClip':
        return (tl) => {
          const clip = tl.tracks.flatMap((t) => t.clips).find((c) => c.id === edit.clipId)!;
          return withClips(withoutClips(tl, [clip.id]), edit.trackId, (cs) => [...cs, { ...clip, start: edit.start }]);
        };
      case 'deleteClip':
        return (tl) => withoutClips(tl, [edit.clipId]);
      case 'deleteClips':
        if (edit.trackIds) throw notModelled(edit);
        return (tl) => withoutClips(tl, edit.clipIds);
      default:
        throw notModelled(edit);
    }
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

const notModelled = (edit: Edit) => new Error(`${edit.kind} is not modelled`);

/** A Timeline with one Track's Clips changed, kept in the order they start. */
function withClips(tl: Timeline, trackId: number, change: (clips: Clip[]) => Clip[]): Timeline {
  return {
    ...tl,
    tracks: tl.tracks.map((t) =>
      t.id === trackId ? { ...t, clips: change(t.clips).sort((a, b) => a.start - b.start) } : t,
    ),
  };
}
