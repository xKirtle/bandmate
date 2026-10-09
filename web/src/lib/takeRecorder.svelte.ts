// Recording a Take onto the chosen Track, at the playhead, or where the
// Track's last Clip ends if the playhead is before that, and recovering
// unsaved Takes. Playback leads in from a little before it and runs on until
// stopped, capturing all along. The lead-in is kept in the Take, hidden
// behind its Clip's start.
//
// A Retake records the same way into a Clip of Takes, from its start as
// trimmed, with that Clip kept silent so the old Take isn't sung against.
//
// What's captured is kept in the browser as it comes, until the server
// confirms the upload (see unsavedTakes.ts). Takes that never reached the
// server, left from an earlier visit to the Song, e.g. by a crashed tab, or
// whose upload just failed, are offered back, to keep, placed as they would
// have been (see recovery.ts), or to discard.
//
// A Take is placed by the Latency Offset of the Input it's recorded from,
// once that Input's open, so the default input's is that of the Input it
// turns out to be. Before an Input's first recording, calibration is
// offered in its place, until it's calibrated or skipped.
//
// The Timeline decides when Record is offered, and draws what's recorded;
// the recorder does the rest, through its ports: Transport, playing along,
// the chosen Input, each Input's calibration, and the copy kept in the
// browser. Saving goes through the
// Song's Saves, whose refreshes are held from the start of a recording
// until its Take is saved, as the Timeline it's made against has to stay
// as it is.
import type { Captured, SongAt, TakePlacement, Timeline } from './api';
import { appliedOffset, type Calibration } from './calibration';
import { Capture, CaptureError, frameAt, inputProblem, type Batch } from './capture';
import { addedTrack } from './chosenTrack';
import { settingTakes } from './history';
import type { InputCalibrations } from './inputCalibrations';
import type { InputChoice } from './inputSettings';
import { LiveWave } from './liveWave';
import { peaks as peaksOf } from './peaks';
import { recordingPlan, retakePlan, sungPastStart, type RecordingPlan } from './recording';
import { recoveredPlacement, takesAt, type TakeTarget, type Unsaved } from './recovery';
import type { Saves } from './saves.svelte';
import { forgetUnsaved, Keeper, unsavedSamples, unsavedTakes, whileHeld, type UnsavedTake } from './unsavedTakes';
import { encodeWav } from './wav';

/** Plays the Timeline along with a recording: Transport, or a fake of it. */
export interface TakePlayer {
  /** Plays from a Timeline time, ignoring the Loop; resolves to whether it's playing once started. */
  playAlong(from: number): Promise<boolean>;
  stop(): void;
  /** The context time at which playback was at the time it started from. */
  readonly startedAt: number;
}

/** The chosen Input: the browser's, or a fake of it. */
export interface TakeInput {
  /** Why recording can't work, where that's known before trying; null when it may well work. */
  problem(): Promise<string | null>;
  /** Opens it and starts capturing. Fails with a CaptureError to show. */
  open(): Promise<OpenedInput>;
}

/** An Input being captured, from when it's opened until it's stopped. */
export interface OpenedInput {
  /** The name of the Input chosen when it isn't connected, so the default is captured instead; null otherwise. */
  readonly gone: string | null;
  /** The Input it records from: the one chosen, or the one the default is; null where that can't be told. */
  readonly input: InputChoice | null;
  readonly sampleRate: number;
  /** The latency the browser reports for it, in seconds, which stands in for an uncalibrated Latency Offset. */
  readonly reported: number;
  /** Hands sink every batch captured, those so far and each one after. */
  keep(sink: (batch: Batch) => void): void;
  /** Stops capturing, and returns what was captured from context time from on. */
  stop(from: number): Promise<Float32Array>;
  /** Stops capturing without keeping anything. */
  close(): void;
}

/** A Take being kept as it's recorded. Nothing it does fails. */
export interface KeptTake {
  add(batch: Batch): void;
  /** Writes what's left, and resolves to its id, or null if it couldn't be kept. */
  finish(): Promise<string | null>;
  /** Lets another tab offer it back. */
  release(): void;
  /** Drops it, e.g. once its upload is confirmed. */
  forget(): Promise<void>;
}

/** Where Takes are kept until they're saved: the browser's store, or a fake of it. */
export interface TakeKeeping {
  /** Starts keeping a Take as it's recorded. */
  keep(details: Omit<UnsavedTake, 'id'>): KeptTake;
  /** The unsaved Takes kept for a Song that no tab is recording or uploading, in the order they were made. */
  list(songId: number): Promise<UnsavedTake[]>;
  /** What an unsaved Take captured, from its first frame on. */
  samples(take: UnsavedTake): Promise<Float32Array>;
  /** Drops an unsaved Take. */
  forget(id: string): Promise<void>;
  /** Holds a Take across tabs while it's uploaded; resolves to what upload does, or null if another tab holds it. */
  whileHeld<T>(id: string, upload: () => Promise<T>): Promise<T | null>;
}

/** Each Input's calibration: those kept on this device, or a fake of them. */
export type TakeCalibrations = Pick<InputCalibrations, 'of'>;

/** The api calls saving a Take makes: the api module's, or the fake Song server's. */
export interface TakeUploads {
  recordTake(at: SongAt, wav: Blob, placement: TakePlacement): Promise<Timeline>;
  retake(at: SongAt, clipId: number, wav: Blob, captured: Captured): Promise<Timeline>;
}

/** The chosen Input, captured on context, telling onOpened which Input it opened for the choice. */
export function capturedInput(
  context: () => AudioContext,
  choice: () => InputChoice,
  onOpened: (choice: InputChoice, input: InputChoice) => void,
): TakeInput {
  return {
    problem: inputProblem,
    open: async () => {
      const chosen = choice();
      const capture = await Capture.open(context(), chosen);
      if (capture.opened) onOpened(chosen, capture.opened);
      return {
        gone: capture.gone,
        input: capture.opened,
        sampleRate: capture.sampleRate,
        reported: capture.latency,
        keep: (sink) => capture.keep(sink),
        stop: (from) => capture.stop(from),
        close: () => capture.close(),
      };
    },
  };
}

/** The browser's store of unsaved Takes (see unsavedTakes.ts). */
export const browserKeeping: TakeKeeping = {
  keep: (details) => new Keeper(details),
  list: unsavedTakes,
  samples: unsavedSamples,
  forget: forgetUnsaved,
  whileHeld,
};

/** An unsaved Take offered back. */
export interface UnsavedOffer {
  /** Its key in the browser, or null where the browser couldn't keep it. */
  id: string | null;
  unsaved: Unsaved;
  sampleRate: number;
  /** Reads back what it captured. */
  samples: () => Promise<Float32Array>;
}

/** What the Timeline knows as Record is pressed. */
export interface Start {
  /** The chosen Track; the last one if it's gone. */
  trackId: number | null;
  playhead: number;
  /** The Clip to retake, for a Retake. */
  retake?: number;
}

export interface TakeRecorderOptions {
  saves: Saves;
  player: TakePlayer;
  input: TakeInput;
  keeping: TakeKeeping;
  calibrations: TakeCalibrations;
  uploads: TakeUploads;
  /**
   * Hears that an Input was never calibrated nor skipped, before its first
   * recording, so nothing was recorded: to offer calibration of it, and
   * start again once it's calibrated or skipped; with the latency the
   * browser reports for it, in seconds, which stands in where it's skipped.
   */
  onUncalibrated?: (input: InputChoice, start: Start, reported: number) => void;
  /** Hears the id of a Track added for an unsaved Take, e.g. to choose it. */
  onTrackAdded?: (trackId: number) => void;
  /** Hears why a recording, or keeping unsaved Takes, failed, e.g. to show it. */
  onError?: (message: string) => void;
}

/** A recording under way. */
interface Recording {
  input: OpenedInput | null;
  /** The context time playback was at plan.from. */
  startedAt: number;
  unsaved: Unsaved | null;
  kept: KeptTake | null;
}

export class TakeRecorder {
  /** Where a recording is, from Record pressed until its Take is saved; null while none is. */
  phase = $state<'starting' | 'recording' | 'saving' | null>(null);
  /** The Clip a Retake goes into, kept silent meanwhile; null for a new Take, or while none is recording. */
  clipId = $state<number | null>(null);
  /** The Track recorded on, once it's started. */
  trackId = $state<number | null>(null);
  /** Where it goes, and where playback starts for it, once it's placed. */
  plan = $state.raw<RecordingPlan | null>(null);
  /** Said of the Input a recording uses, e.g. that the one chosen isn't connected. */
  inputNote = $state<string | null>(null);
  /** The unsaved Takes offered back. */
  unsaved = $state.raw<UnsavedOffer[]>([]);
  /** Whether unsaved Takes are being kept. */
  recovering = $state(false);

  #saves: Saves;
  #player: TakePlayer;
  #input: TakeInput;
  #keeping: TakeKeeping;
  #calibrations: TakeCalibrations;
  #uploads: TakeUploads;
  #onUncalibrated: (input: InputChoice, start: Start, reported: number) => void;
  #onTrackAdded: (trackId: number) => void;
  #onError: (message: string) => void;

  #recording: Recording | null = null;
  #wave: LiveWave | null = null;
  /** Counts the batches the waveform has had, to draw each. */
  #waveVersion = $state(0);
  #release: (() => void) | null = null;
  #closed = false;

  constructor(options: TakeRecorderOptions) {
    this.#saves = options.saves;
    this.#player = options.player;
    this.#input = options.input;
    this.#keeping = options.keeping;
    this.#calibrations = options.calibrations;
    this.#uploads = options.uploads;
    this.#onUncalibrated = options.onUncalibrated ?? (() => {});
    this.#onTrackAdded = options.onTrackAdded ?? (() => {});
    this.#onError = options.onError ?? (() => {});
  }

  /** Whether a recording is capturing, rather than starting or saving. */
  get capturing(): boolean {
    return this.phase === 'recording';
  }

  /**
   * The waveform recorded so far, from its Clip's start, as a bar every
   * secondsPerBar, in tiles (see liveWave.ts).
   */
  liveTiles(secondsPerBar: number): readonly (readonly number[])[] {
    void this.#waveVersion;
    return this.#wave?.tiles(secondsPerBar) ?? [];
  }

  /**
   * Records a Take onto a Track, or into a Clip of Takes for a Retake. It
   * opens the Input first, and only then places the Take, on the Timeline
   * as saved. An Input never calibrated nor skipped records nothing: it's
   * told of, to offer calibration of it first.
   */
  async start(start: Start): Promise<void> {
    const { trackId: chosen, playhead, retake } = start;
    if (this.phase !== null || this.#closed) return;
    this.phase = 'starting';
    this.clipId = retake ?? null;
    this.trackId = null;
    this.plan = null;
    this.inputNote = null;
    this.#release = this.#saves.hold();
    const recording: Recording = { input: null, startedAt: 0, unsaved: null, kept: null };
    this.#recording = recording;
    try {
      // Said up front where it can be, in place of a recording that fails.
      const trouble = await this.#input.problem();
      if (trouble) throw new CaptureError(trouble);
      const input = (recording.input = await this.#input.open());
      if (this.#closed) throw new CaptureError('The Timeline closed before recording started.');
      const calibration = this.#calibrations.of(input.input);
      if (input.input && uncalibrated(calibration)) {
        input.close();
        this.#done();
        this.#onUncalibrated(input.input, start, input.reported);
        return;
      }
      if (input.gone) this.inputNote = `${input.gone} isn't connected, so recording from the default input.`;
      // Placed once the Input's open, in case the Timeline changed meanwhile.
      const { tracks } = this.#saves.timeline;
      const target = retake !== undefined && tracks.find((t) => t.clips.some((c) => c.id === retake));
      if (retake !== undefined && !target) throw new CaptureError('The Clip to retake is gone.');
      const track = target || (tracks.find((t) => t.id === chosen) ?? tracks.at(-1)!);
      const clip = retake !== undefined && track.clips.find((c) => c.id === retake)!;
      const plan = clip ? retakePlan(clip) : recordingPlan(track.clips, playhead);
      this.plan = plan;
      if (!(await this.#player.playAlong(plan.from))) throw new CaptureError('Recording stopped before it started.');
      const { startedAt } = this.#player;
      const unsaved: Unsaved = {
        trackId: track.id,
        clipId: this.clipId,
        takes: clip ? takesAt(clip) : [],
        plan,
        latencyOffset: appliedOffset(calibration, input.reported),
      };
      const first = frameAt(startedAt, input.sampleRate);
      const kept = this.#keeping.keep({
        ...unsaved,
        songId: this.#saves.saved.id,
        sampleRate: input.sampleRate,
        first,
        recordedAt: new Date().toISOString(),
      });
      // Drawn from where the Take will be placed: its Clip's start, heard its Latency Offset after it was captured.
      const wave = new LiveWave(first, input.sampleRate, plan.start - plan.from + unsaved.latencyOffset);
      this.#wave = wave;
      this.#waveVersion = 0;
      input.keep((batch) => {
        kept.add(batch);
        wave.add(batch);
        this.#waveVersion++;
      });
      Object.assign(recording, { startedAt, unsaved, kept });
      this.trackId = track.id;
      this.phase = 'recording';
    } catch (e) {
      recording.input?.close();
      this.#onError(e instanceof CaptureError ? e.message : `Couldn't start recording (${(e as Error).message}).`);
      this.#done();
    }
  }

  /**
   * Stops recording, and saves the Take, unless it stopped during the
   * lead-in with nothing to keep. A Take that fails to save is offered back.
   */
  async stop(): Promise<void> {
    const r = this.#recording;
    const { plan, trackId } = this;
    if (this.phase !== 'recording' || !r?.input || !r.unsaved || !r.kept || !plan || trackId === null) return;
    this.phase = 'saving';
    this.#player.stop();
    const samples = await r.input.stop(r.startedAt);
    const rate = r.input.sampleRate;
    const { latencyOffset } = r.unsaved;
    // What was sung after the lead-in, placed where it was heard.
    if (!sungPastStart(plan, samples.length / rate, latencyOffset)) {
      void r.kept.forget();
      this.#onError('Recording stopped during the lead-in, so there was nothing to keep.');
      this.#done();
      return;
    }
    const { clipId } = this;
    const target: TakeTarget = clipId === null ? { trackId, start: plan.start } : { clipId };
    const ok = await this.#saveTake(() => ({ target, captureStart: plan.from }), samples, rate, latencyOffset);
    if (ok) void r.kept.forget();
    else {
      // Offered back, to try again or discard.
      const id = await r.kept.finish();
      r.kept.release();
      this.unsaved = [...this.unsaved, { id, unsaved: r.unsaved, sampleRate: rate, samples: async () => samples }];
    }
    this.#done();
  }

  /** Ends a recording, saved or not, letting refreshes through again. */
  #done() {
    this.#recording = null;
    this.#wave = null;
    this.phase = null;
    this.clipId = null;
    this.trackId = null;
    this.plan = null;
    this.#release?.();
    this.#release = null;
  }

  /**
   * Uploads a Take recorded, into a Clip of Takes, or in a new Clip on a
   * Track, through Saves; resolves to whether it was saved. Where it goes
   * is decided when its turn comes, on the Timeline as saved then.
   */
  #saveTake(
    place: (timeline: Timeline) => { target: TakeTarget | null; captureStart: number },
    samples: Float32Array,
    rate: number,
    latencyOffset: number,
  ): Promise<boolean> {
    const wav = new Blob([encodeWav([samples], rate)], { type: 'audio/wav' });
    const peaks = peaksOf([samples], rate);
    return this.#saves
      .make(async (at, timeline) => {
        const { target, captureStart } = place(timeline);
        if (!target) throw new Error("There's no Track to put the Take on.");
        const details = { captureStart, latencyOffset, peaks };
        if ('clipId' in target) {
          const after = await this.#uploads.retake(at, target.clipId, wav, details);
          return { timeline: after, kept: settingTakes(after, target.clipId) };
        }
        return { timeline: await this.#uploads.recordTake(at, wav, { ...target, ...details }), kept: 'take' as const };
      })
      .then((made) => made !== null);
  }

  /** Offers back the unsaved Takes kept for the Song, along with any that failed to upload meanwhile. */
  async loadUnsaved(): Promise<void> {
    const kept = await this.#keeping.list(this.#saves.saved.id);
    if (kept.length === 0) return;
    const offered = kept.map((t) => ({
      id: t.id,
      unsaved: t,
      sampleRate: t.sampleRate,
      samples: () => this.#keeping.samples(t),
    }));
    this.unsaved = [...offered, ...this.unsaved.filter((o) => !kept.some((t) => t.id === o.id))];
  }

  /** Keeps the unsaved Takes offered, one after another, until one can't be. */
  async keepUnsaved(): Promise<void> {
    if (this.recovering || this.phase !== null) return;
    this.recovering = true;
    try {
      for (const offer of this.unsaved) {
        if (!(await this.#keepOne(offer))) break;
      }
    } finally {
      this.recovering = false;
    }
  }

  /** Keeps an unsaved Take; resolves to whether it's no longer offered. */
  async #keepOne(offer: UnsavedOffer): Promise<boolean> {
    let samples: Float32Array;
    try {
      samples = await offer.samples();
    } catch {
      this.#onError("Couldn't read the unsaved Take back from this browser.");
      return false;
    }
    const duration = samples.length / offer.sampleRate;
    let added: number | null = null;
    const place = (timeline: Timeline) => recoveredPlacement(timeline.tracks, offer.unsaved, duration, added);
    const placement = place(this.#saves.timeline);
    // Stopped during the lead-in: there's nothing to keep.
    if (placement === null) {
      await this.#drop(offer);
      return true;
    }
    // Once its own Track is gone, a new one's added for it.
    if (placement.target === null) {
      added = await this.#addTrack();
      if (added === null) return false;
    }
    const upload = () => this.#saveTake((tl) => place(tl)!, samples, offer.sampleRate, offer.unsaved.latencyOffset);
    const ok = offer.id === null ? await upload() : await this.#keeping.whileHeld(offer.id, upload);
    if (ok === false) return false;
    // Null where another tab is uploading it already, which drops it once it's done.
    if (ok === null) this.unsaved = this.unsaved.filter((o) => o !== offer);
    else await this.#drop(offer);
    return true;
  }

  /** Adds a Track at the bottom for an unsaved Take; resolves to its id, or null if it wasn't added. */
  async #addTrack(): Promise<number | null> {
    const name = `Track ${this.#saves.timeline.tracks.length + 1}`;
    const edited = await this.#saves.edit({ kind: 'addTrack', track: { name } });
    const added = edited && addedTrack(edited.before.tracks, edited.after.tracks);
    if (added) this.#onTrackAdded(added);
    return added ?? null;
  }

  /** Stops offering an unsaved Take, and drops it from the browser. */
  async #drop(offer: UnsavedOffer) {
    this.unsaved = this.unsaved.filter((o) => o !== offer);
    if (offer.id !== null) await this.#keeping.forget(offer.id);
  }

  /** Discards every unsaved Take offered. */
  discardUnsaved() {
    if (this.recovering || this.phase !== null) return;
    for (const offer of this.unsaved) void this.#drop(offer);
  }

  /** Writes what's been captured but not yet kept, e.g. as the tab closes, to offer it back. */
  flush() {
    void this.#recording?.kept?.finish();
  }

  /**
   * Lets go when the Timeline goes: an Input still opening is let go as soon
   * as it opens, and what was captured so far is offered back on the next
   * visit. A Take saving is let go of once saved, or not.
   */
  close() {
    this.#closed = true;
    const r = this.#recording;
    r?.input?.close();
    const kept = this.phase === 'recording' ? r?.kept : null;
    kept?.finish().then(() => kept.release());
    this.#release?.();
    this.#release = null;
  }
}

/** Whether an Input was never calibrated, nor calibration skipped for it. */
function uncalibrated(calibration: Calibration): boolean {
  return calibration.offset === null && !calibration.offered;
}
