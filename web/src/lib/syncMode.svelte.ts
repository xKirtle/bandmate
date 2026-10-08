// Sync mode: syncing a Song's Lines while the Timeline plays (see the
// GLOSSARY), made once per Song by the Song page and handed to the Lyric
// Sheet, which draws it and sends its keys and clicks here, and to the
// Timeline, which refuses Record while it's on.
//
// It keeps Sync mode's rules:
// - It's only on in Write mode, on a wide screen, with a Clip on the
//   Timeline, while not recording, and with the Timeline attached.
// - It and the Loop are never on together, so going round the Loop
//   mid-pass can't cue Lines out of order: switching it on switches the
//   Loop off, and the Loop coming on, however it does (switched on, set by
//   dragging, brought back by an undo), ends it.
// - Recording starting ends it, and the Timeline refuses Record while it's on.
// - Changing the lyrics ends it, through Lyric Sheet editing calling end().
// - Once ended, for whatever reason, it stays off until switched on again,
//   even when what ended it changes back.
//
// It reads the Loop, recording, the Clips and the playhead from the
// Timeline, through the port the Timeline attaches while it's mounted,
// rather than keeping copies of them.
import { untrack } from 'svelte';
import type { Song } from './api';
import type { CueChange } from './cueChanges';
import { nextLine, type NextLine } from './cues';
import { deviceStorage } from './deviceStorage';
import { lineName } from './sections';
import type { Mode } from './songMode';
import { markSyncHintSeen, sawSyncHint } from './syncHint';

/** What Sync mode reads from the Timeline, and asks of it. */
export interface SyncPort {
  /** Whether the Loop is on. */
  readonly loopOn: boolean;
  /** Switches the Loop off, if it's on. */
  stopLoop(): void;
  /** Whether a recording is on, from pressing Record until its Take is saved. */
  readonly recording: boolean;
  /** Whether the Timeline has any Clip, so there's something to cue along to. */
  readonly hasClips: boolean;
  /** Where the playhead is, playing or paused, in seconds. */
  playheadAt(): number;
}

export interface SyncModeOptions {
  /** The Song page's mode: Sync mode is only on in Write mode. */
  mode: () => Mode;
  /** Whether the screen is wide enough to edit Cues: Sync mode is only on where it is. */
  wide: () => boolean;
  /** The Song as shown, Cue changes not saved yet made on top, whose Lines are cued; null until it's loaded. */
  song: () => Song | null;
  /**
   * Makes a Cue change, naming what it changes, e.g. "the Cue of Line 3 of
   * Verse", in case it has to be taken back; resolves to whether it was saved.
   */
  cue: (change: CueChange, what: string) => Promise<boolean>;
  /** The Device's storage, where the first-time hint is remembered as seen. By default this device's. */
  storage?: Storage;
}

export class SyncMode {
  #options: SyncModeOptions;
  #storage: Storage | undefined;
  /** The Timeline's port, while it's attached. */
  #port = $state<SyncPort | null>(null);
  /** Whether Sync mode was switched on and hasn't ended since. */
  #switchedOn = $state(false);
  /**
   * What the Line up next is worked out from: the Line last cued, or a Line
   * picked by clicking it. It doesn't follow playback, so playback can start
   * anywhere, and the Line up next only moves on as Lines are cued, whether
   * or not their Cues are saved yet. A Cue taken back, as its save failed,
   * leaves it where it is.
   */
  #from = $state.raw<{ cued: NextLine | null; picked: NextLine | null }>({ cued: null, picked: null });
  /** Whether this switching on is the first on this Device. */
  #firstTime = $state(false);

  /**
   * Whether Sync mode can be switched on: in Write mode, on a wide screen,
   * with a Clip on the attached Timeline, while not recording. The Loop
   * being on doesn't stop it, as switching it on switches the Loop off.
   */
  readonly canBeOn: boolean = $derived.by(() => {
    const port = this.#port;
    const { mode, wide } = this.#options;
    return port !== null && mode() === 'write' && wide() && port.hasClips && !port.recording;
  });

  /** Whether Sync mode is on. */
  readonly on: boolean = $derived(this.#switchedOn && this.canBeOn && !this.#port?.loopOn);

  /** The Line Sync mode cues next, while it's on, marked by a Now button in its gutter slot. */
  readonly next: NextLine | null = $derived.by(() => {
    const song = this.#options.song();
    return this.on && song ? nextLine(song, this.#from) : null;
  });

  /** Whether to show the hint saying how to use Sync mode: while it's on, the first time it came on on this Device. */
  readonly hint: boolean = $derived(this.on && this.#firstTime);

  constructor(options: SyncModeOptions) {
    this.#options = options;
    this.#storage = options.storage ?? deviceStorage();
    // Ending is kept: once it can't be on, it's off until switched on again.
    $effect(() => {
      if (!this.on) untrack(() => (this.#switchedOn = false));
    });
  }

  /**
   * Attaches the Timeline's port, as the Timeline is mounted. Returns what
   * detaches it, as the Timeline is destroyed, which ends Sync mode.
   */
  attach(port: SyncPort): () => void {
    this.#port = port;
    return () => {
      if (this.#port === port) this.#port = null;
    };
  }

  /**
   * Switches Sync mode on, switching the Loop off, or off. It comes on with
   * the first Line without a Cue up next.
   */
  switch() {
    if (this.on) return this.end();
    if (!this.canBeOn) return;
    this.#switchedOn = true;
    this.#port?.stopLoop();
    this.#from = { cued: null, picked: null };
    this.#firstTime = !sawSyncHint(this.#storage);
    markSyncHintSeen(this.#storage);
  }

  /** Ends Sync mode, e.g. as the lyrics change. */
  end() {
    this.#switchedOn = false;
  }

  /**
   * Cues the Line up next at the playhead. Its Cue shows at once, so it
   * becomes the Line playing, as playback is already at its Cue, and the
   * Line after it comes up next.
   */
  cue() {
    const line = this.next;
    const song = this.#options.song();
    if (!line || !song || !this.#port) return;
    this.#from = { cued: line, picked: null };
    const change: CueChange = { kind: 'setLineCue', lineId: line.line, cue: this.#port.playheadAt() };
    this.#options.cue(change, `the Cue of ${lineName(song, line)}`);
  }

  /** Makes a Line, as clicked, the one up next. */
  pick(line: NextLine) {
    if (this.on) this.#from = { cued: null, picked: line };
  }
}
