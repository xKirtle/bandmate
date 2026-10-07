// An in-memory SongServer, for testing Saves without the api: one Song and
// its Timeline, sharing a version, as the server keeps them.
import { ApiError, type Song, type SongAt, type Timeline } from './api';
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
 * here with `update` and `remove`.
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

  constructor(song: Song = emptySong()) {
    this.song = structuredClone(song);
    this.timeline = {
      songId: song.id,
      version: song.version,
      updatedAt: song.updatedAt,
      tracks: [],
      beats: [],
      sounds: [],
      loop: null,
    };
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
    let loop: Timeline['loop'];
    try {
      loop = loopAfter(this.timeline, change);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.#write(at, () => {
      this.timeline = { ...this.timeline, loop };
      return structuredClone(this.timeline);
    });
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

/** The Loop a Timeline edit leaves; the Loop's edits are the only ones the fake models. */
function loopAfter(timeline: Timeline, edit: Edit): Timeline['loop'] {
  switch (edit.kind) {
    case 'setLoop':
      return { ...edit.loop };
    case 'switchLoop':
      return timeline.loop && { ...timeline.loop, on: edit.on };
    case 'clearLoop':
      return null;
    default:
      throw new Error(`${edit.kind} is not modelled`);
  }
}
