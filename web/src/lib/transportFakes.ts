// In-memory fakes of Transport's ports, for testing it without browser
// audio or frames: a player on a clock that's set, and frames stepped by
// hand.
import { positionAt, repeats, type Loop } from './schedule';
import type { PlayableClip, PlayerState } from './timelinePlayer';
import type { Frames, TransportPlayer } from './transport.svelte';

/** What a play asked for. */
export interface Played {
  clips: readonly PlayableClip[];
  from: number;
  loop: Loop | null;
}

/**
 * A player as the Timeline's plays, on a clock the test sets, in context
 * seconds. A play loads until the next microtask, then plays from the
 * clock's time then, unless it's told to fail or be held meanwhile.
 */
export class FakeTimelinePlayer implements TransportPlayer {
  /** The context time, in seconds. */
  now = 100;
  /** Each play asked for, in order. */
  plays: Played[] = [];
  /** Why the next play fails, if it does. */
  failing: string | null = null;
  state: PlayerState = 'stopped';
  startedAt = 0;
  #from = 0;
  #loop: Loop | null = null;
  #generation = 0;
  #holding: Promise<void> | null = null;

  constructor(private onState: (state: PlayerState) => void) {}

  /** Holds the next play loading until the function returned is called. */
  holdLoading(): () => void {
    let release!: () => void;
    this.#holding = new Promise((done) => (release = done));
    return release;
  }

  position(): number {
    if (this.state !== 'playing') return this.#from;
    return positionAt(this.#from, this.#loop, Math.max(0, this.now - this.startedAt));
  }

  get repeating(): boolean {
    return this.state === 'playing' && repeats(this.#from, this.#loop);
  }

  async play(clips: readonly PlayableClip[], from: number, loop: Loop | null = null): Promise<void> {
    this.plays.push({ clips, from, loop });
    const generation = ++this.#generation;
    this.#from = from;
    this.#setState('loading');
    const holding = this.#holding;
    this.#holding = null;
    await holding;
    if (generation !== this.#generation) return;
    if (this.failing) {
      this.#setState('stopped');
      throw new Error(this.failing);
    }
    this.#loop = loop;
    this.startedAt = this.now;
    this.#setState('playing');
  }

  stop() {
    this.#from = this.position();
    this.#generation++;
    this.#setState('stopped');
  }

  seek(to: number) {
    if (this.state === 'stopped') this.#from = to;
  }

  #setState(state: PlayerState) {
    if (state === this.state) return;
    this.state = state;
    this.onState(state);
  }
}

/** Frames asked for, run when the test steps them. */
export class FakeFrames implements Frames {
  #next = 1;
  #pending = new Map<number, () => void>();

  request(callback: () => void): number {
    const id = this.#next++;
    this.#pending.set(id, callback);
    return id;
  }

  cancel(id: number) {
    this.#pending.delete(id);
  }

  /** How many frames are waiting to run. */
  get waiting(): number {
    return this.#pending.size;
  }

  /** Runs the frames asked for so far, which may ask for the next. */
  step() {
    const due = [...this.#pending.values()];
    this.#pending.clear();
    for (const callback of due) callback();
  }
}
