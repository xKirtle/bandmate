// Transport (a code name): how the Timeline plays. It plays, pauses and
// seeks through the Timeline's player, moves the playhead every frame, and
// stops at the end, unless a Loop is yet to go round or a recording runs on.
//
// What plays, the Loop and the length are read from the Timeline as they
// are; a change to what plays, while playing, restarts it from where it is.
// A recording plays from where it starts, in time with what it captures, so
// it isn't moved while one is on, and playback stopped while capturing ends
// it. TakeRecorder plays along with a recording through it.
import { untrack } from 'svelte';
import { repeats, type Loop } from './schedule';
import type { TakePlayer } from './takeRecorder.svelte';
import type { PlayableClip, PlayerState } from './timelinePlayer';

/** Plays the Timeline: the Timeline's player, or a fake of it. */
export interface TransportPlayer {
  readonly state: PlayerState;
  /** Plays clips from a Timeline position, repeating the Loop if one's given, in place of anything playing. */
  play(clips: readonly PlayableClip[], from: number, loop: Loop | null): Promise<void>;
  /** Stops playing, keeping the position to resume from. */
  stop(): void;
  /** Moves the position while stopped. */
  seek(to: number): void;
  /** The Timeline position, in seconds. */
  position(): number;
  /** The context time at which playback is, or was, at the position it started from. */
  readonly startedAt: number;
  /** Whether playing goes round a Loop for ever, rather than stopping at the end. */
  readonly repeating: boolean;
}

/** Runs a callback on the next frame: the browser's, or frames stepped by hand. */
export interface Frames {
  request(callback: (now: number) => void): number;
  cancel(id: number): void;
}

/** The browser's frames. */
export const browserFrames: Frames = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
};

export interface TransportOptions {
  /** Makes the player, handing it what hears each change to its state. */
  player: (onState: (state: PlayerState) => void) => TransportPlayer;
  /** The Clips that play, as mixed. */
  playable: () => readonly PlayableClip[];
  /** The Loop as it plays, or null while it's off. */
  loop: () => Loop | null;
  /** Where the Timeline ends, as shown, in seconds. */
  length: () => number;
  /** Whether a recording is on, from Record pressed until its Take is saved. */
  recording: () => boolean;
  /** Whether a recording is capturing, rather than starting or saving. */
  capturing: () => boolean;
  /** Hears playback stopped while capturing, by Space or by something else playing, to stop the recording. */
  onCaptureStopped: () => void;
  /** Hears why playing failed, or null as Play is pressed, to clear what was said. */
  onError?: (message: string | null) => void;
  /** Hears playback starting from stopped, by hand or for a recording, e.g. to follow the playhead. */
  onPlay?: () => void;
  /** Whether the playhead is dragged by hand, so frames leave it where it's dragged. */
  dragging?: () => boolean;
  /** Hears the playhead each frame while playing on, e.g. to scroll it into view. */
  onFrame?: (position: number) => void;
  /** The frames the playhead moves on; the browser's by default. */
  frames?: Frames;
}

export class Transport implements TakePlayer {
  #state = $state<PlayerState>('stopped');
  #position = $state(0);
  /** Whether playback stopped by reaching the end, keeping the playhead there until it's moved. */
  #ended = $state(false);

  #player: TransportPlayer;
  #options: TransportOptions;
  #frames: Frames;

  constructor(options: TransportOptions) {
    this.#options = options;
    this.#frames = options.frames ?? browserFrames;
    this.#player = options.player((state) => this.#stateChanged(state));

    // A change to what plays is heard right away. The Timeline is replaced
    // after every change to it, so compare what would play, not the
    // objects, and in an order reordering Tracks doesn't change. The Loop
    // never moves the playhead: playing, it starts over from where it is.
    const playing = $derived(
      JSON.stringify([
        [...options.playable()].sort((a, b) => a.trackId - b.trackId || a.start - b.start),
        options.loop(),
      ]),
    );
    $effect(() => {
      void playing;
      untrack(() => {
        // A recording plays on as it started, in time with what it captures.
        if (options.capturing()) return;
        if (this.#state !== 'stopped') this.#play(this.#player.position());
      });
    });

    // Moves the playhead every frame while playing, and stops at the end,
    // unless going round the Loop.
    $effect(() => {
      if (this.#state !== 'playing') return;
      const step = () => {
        if (!options.dragging?.()) this.#position = this.#player.position();
        // A recording runs on past the end until it's stopped.
        const length = options.length();
        if (this.#position >= length && !this.#player.repeating && !options.capturing()) {
          this.#ended = true;
          this.#player.stop();
          this.#player.seek(length);
          this.#position = length;
          return;
        }
        options.onFrame?.(this.#position);
        frame = this.#frames.request(step);
      };
      let frame = this.#frames.request(step);
      return () => this.#frames.cancel(frame);
    });
  }

  /** Whether the player is stopped, loading or playing. */
  get state(): PlayerState {
    return this.#state;
  }

  /** Where the playhead is, in seconds: moved every frame while playing. */
  get position(): number {
    return this.#position;
  }

  /**
   * Where playback is for the Song page to follow: the playhead while
   * playing, or while starting over from elsewhere, and once it's reached
   * the end, until it's moved; null once stopped.
   */
  get playingAt(): number | null {
    return this.#state === 'stopped' && !this.#ended ? null : this.#position;
  }

  /** The context time at which playback was at the time it started from, e.g. to line up a recording. */
  get startedAt(): number {
    return this.#player.startedAt;
  }

  /** Where the playhead is, playing or paused, in seconds to the millisecond, e.g. to cue a Line at. */
  playheadAt(): number {
    const at = this.#state === 'stopped' ? this.#position : this.#player.position();
    return Math.round(at * 1000) / 1000;
  }

  /**
   * Plays or pauses. Playing from the end starts over, unless a Loop is yet
   * to go round. During a recording, it stops one that's capturing, and
   * does nothing while one starts or saves.
   */
  toggle() {
    if (this.#options.recording()) {
      // Stopping playback ends the capture, through the hook.
      if (this.#options.capturing()) this.stop();
      return;
    }
    if (this.#state !== 'stopped') {
      this.stop();
      return;
    }
    const loop = this.#options.loop();
    const position = this.#position;
    this.#options.onPlay?.();
    this.#play(position >= this.#options.length() && !repeats(position, loop) ? 0 : position);
  }

  /**
   * Moves the playhead: while playing, playback jumps there. A recording
   * plays from where it starts, in time with what it captures, so it isn't
   * moved while one is on.
   */
  seek(to: number) {
    if (this.#options.recording()) return;
    this.#position = to;
    this.#ended = false;
    if (this.#state === 'stopped') this.#player.seek(to);
    else this.#play(to);
  }

  /**
   * Plays from a time asked for, e.g. leading into a Cue: starts playback
   * there, or jumps there if it's playing already, never pausing it. Not
   * while a recording is on.
   */
  playFrom(at: number) {
    if (this.#options.recording()) return;
    this.seek(at);
    if (this.#state !== 'stopped') return;
    this.#options.onPlay?.();
    this.#play(at);
  }

  /** Moves the playhead shown while it's dragged and playing: playback jumps there only once it's let go. */
  dragTo(at: number) {
    this.#position = at;
  }

  /**
   * Plays along with a recording from a time: everything that plays, but
   * ignoring the Loop. Resolves to whether it's playing once started.
   */
  async playAlong(from: number): Promise<boolean> {
    this.#options.onPlay?.();
    this.#ended = false;
    this.#position = from;
    await this.#player.play(this.#options.playable(), from, null);
    return this.#player.state === 'playing';
  }

  /** Stops playing, keeping the playhead where it is. */
  stop() {
    if (this.#state === 'stopped') return;
    this.#player.stop();
    this.#position = this.#player.position();
  }

  /** Starts playing what plays from a time, with the Loop as it plays, in place of anything playing. */
  #play(from: number) {
    this.#ended = false;
    this.#options.onError?.(null);
    this.#player
      .play(this.#options.playable(), from, this.#options.loop())
      .catch((e: Error) => this.#options.onError?.(e.message));
  }

  #stateChanged(state: PlayerState) {
    this.#state = state;
    if (state !== 'stopped') return;
    // Also when something else playing stopped it.
    this.#position = this.#player.position();
    if (this.#options.capturing()) this.#options.onCaptureStopped();
  }
}
