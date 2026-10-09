// In-memory fakes of TakeRecorder's ports, for testing it without browser
// audio or storage: a player on a clock that's set, an Input that captures
// what it's told to, a store of unsaved Takes, and each Input's calibration.
import type { Calibration } from './calibration';
import { CaptureError, frameAt, samplesFrom, type Batch } from './capture';
import type { InputId } from './inputCalibrations';
import type { InputChoice } from './inputSettings';
import type {
  KeptTake,
  OpenedInput,
  TakeCalibrations,
  TakeInput,
  TakeKeeping,
  TakePlayer,
} from './takeRecorder.svelte';
import type { UnsavedTake } from './unsavedTakes';

/** A player whose playback starts at the context time given, or never, when told it's stopped meanwhile. */
export class FakePlayer implements TakePlayer {
  playing = false;
  /** Where each play started from. */
  played: number[] = [];
  startedAt: number;
  /** Whether the next play is stopped before it starts, e.g. by something else playing. */
  stopsBeforeStart = false;

  constructor(startedAt = 10) {
    this.startedAt = startedAt;
  }

  playAlong(from: number): Promise<boolean> {
    this.played.push(from);
    this.playing = !this.stopsBeforeStart;
    return Promise.resolve(this.playing);
  }

  stop() {
    this.playing = false;
  }
}

/** Two Inputs of one interface: its mic and its instrument jack. */
export const mic: InputChoice = { deviceId: 'scarlett', label: 'Scarlett Solo USB', channel: 0 };
export const guitar: InputChoice = { deviceId: 'scarlett', label: 'Scarlett Solo USB', channel: 1 };

/** Each Input's calibration, as set, and every other Input's the same. */
export class FakeCalibrations implements TakeCalibrations {
  #set = new Map<string, Calibration>();

  constructor(public others: Calibration) {}

  of(input: InputId | null): Calibration {
    return (input && this.#set.get(`${input.deviceId}/${input.channel}`)) || this.others;
  }

  set(input: InputId, calibration: Calibration) {
    this.#set.set(`${input.deviceId}/${input.channel}`, calibration);
  }
}

/**
 * An Input capturing at a rate, from the Input it records from, with the latency the browser reports, that can be gone, have a
 * problem known before trying, fail to open, or be held opening until
 * released. Once open, sing captures what's sung.
 */
export class FakeInput implements TakeInput {
  /** Why recording can't work, known before trying. */
  problemFound: string | null = null;
  /** The name of the Input chosen, when it isn't connected. */
  gone: string | null = null;
  /** Why it fails to open, if it does. */
  failing: string | null = null;
  /** The Input it records from: the one chosen, or the default's. */
  recordsFrom: InputChoice | null = mic;
  opened: FakeOpenedInput | null = null;
  #holding: Promise<void> | null = null;

  constructor(
    readonly sampleRate = 100,
    public reported = 0,
  ) {}

  problem(): Promise<string | null> {
    return Promise.resolve(this.problemFound);
  }

  /** Holds the next open until the function returned is called. */
  holdOpen(): () => void {
    let release!: () => void;
    this.#holding = new Promise((done) => (release = done));
    return release;
  }

  async open(): Promise<OpenedInput> {
    if (this.failing) throw new CaptureError(this.failing);
    await this.#holding;
    this.opened = new FakeOpenedInput(this.sampleRate, this.recordsFrom, this.reported, this.gone);
    return this.opened;
  }
}

/** An Input opened, capturing what's sung into it, until it's stopped or closed. */
export class FakeOpenedInput implements OpenedInput {
  #batches: Batch[] = [];
  #sink: ((batch: Batch) => void) | null = null;
  closed = false;

  constructor(
    readonly sampleRate: number,
    readonly input: InputChoice | null,
    readonly reported: number,
    readonly gone: string | null,
  ) {}

  /** Captures seconds of sound at loudness, from context time at on. */
  sing(at: number, seconds: number, loudness = 0.5) {
    const batch = {
      frame: frameAt(at, this.sampleRate),
      samples: new Float32Array(Math.round(seconds * this.sampleRate)).fill(loudness),
    };
    this.#batches.push(batch);
    this.#sink?.(batch);
  }

  keep(sink: (batch: Batch) => void) {
    for (const batch of this.#batches) sink(batch);
    this.#sink = sink;
  }

  stop(from: number): Promise<Float32Array> {
    this.close();
    return Promise.resolve(samplesFrom(this.#batches, frameAt(from, this.sampleRate)));
  }

  close() {
    this.closed = true;
    this.#sink = null;
  }
}

/** An unsaved Take kept, with what it captured, and whether a tab holds it. */
interface Stored {
  take: UnsavedTake;
  batches: Batch[];
  held: boolean;
}

/** A store of unsaved Takes, which can hold one as if another tab were uploading it. */
export class FakeKeeping implements TakeKeeping {
  stored = new Map<string, Stored>();
  #ids = 0;

  /** Puts an unsaved Take in the store, as an earlier visit left it, capturing samples from its first frame. */
  put(take: Omit<UnsavedTake, 'id'>, samples: Float32Array): string {
    const id = `take-${++this.#ids}`;
    this.stored.set(id, { take: { ...take, id }, batches: [{ frame: take.first, samples }], held: false });
    return id;
  }

  /** The unsaved Takes kept, held or not. */
  get takes(): UnsavedTake[] {
    return [...this.stored.values()].map((s) => s.take);
  }

  keep(details: Omit<UnsavedTake, 'id'>): KeptTake {
    const id = `take-${++this.#ids}`;
    const stored: Stored = { take: { ...details, id }, batches: [], held: true };
    this.stored.set(id, stored);
    return {
      add: (batch) => stored.batches.push(batch),
      finish: () => Promise.resolve(this.stored.has(id) ? id : null),
      release: () => (stored.held = false),
      forget: () => {
        stored.held = false;
        return this.forget(id);
      },
    };
  }

  list(songId: number): Promise<UnsavedTake[]> {
    return Promise.resolve(
      [...this.stored.values()].filter((s) => s.take.songId === songId && !s.held).map((s) => s.take),
    );
  }

  samples(take: UnsavedTake): Promise<Float32Array> {
    const stored = this.stored.get(take.id);
    if (!stored) return Promise.reject(new Error('Not kept'));
    return Promise.resolve(samplesFrom(stored.batches, take.first));
  }

  forget(id: string): Promise<void> {
    this.stored.delete(id);
    return Promise.resolve();
  }

  async whileHeld<T>(id: string, upload: () => Promise<T>): Promise<T | null> {
    const stored = this.stored.get(id);
    if (stored?.held) return null;
    if (stored) stored.held = true;
    try {
      return await upload();
    } finally {
      if (stored) stored.held = false;
    }
  }
}
