// Plays the Timeline: every Clip's audio is fetched, decoded into memory,
// stretched to its Tempo (see stretch.ts) and scheduled on one AudioContext, so Tracks stay sample-accurate with each
// other (ADR 0006). Each Clip plays at its Gain, shaped by its Fades,
// through its Track's own gain, which follows the Track's volume, mute and
// solo live: wired by TrackMix, which a Mixdown and a Merge build their
// graph with too, so they sound as playback would. A Loop's repeats are
// scheduled a little ahead as they come round, each starting exactly as the
// one before ends.
import { fadeCurves, type PlacedFades } from './clipFade';
import { sourceLength, timelineAt, timelineLength } from './clipTime';
import { hotKept } from './hotKept';
import { playAlone, release } from './playback';
import { positionAt, repeats, schedule, type Loop, type Placed } from './schedule';
import { stretch, stretches } from './stretch';

/** A Clip to play, with where its source's audio is fetched from, the Track it's on, its Gain and its Fades. */
export interface PlayableClip extends Placed {
  /** How fast it plays its source, which its audio is stretched to. */
  tempo: number;
  source: string;
  trackId: number;
  /** Its Gain, as a factor of its audio, applied before its Track's. */
  gainFactor: number;
  /** Its Fades, from the Clip's own edges, which a Take's audio may start after; left out if it has none. */
  fades?: PlacedFades;
}

export type PlayerState = 'stopped' | 'loading' | 'playing';

/** What a Clip's audio is, as it plays on the Timeline: its source, stretched to its Tempo. */
export type ClipAudio = Pick<PlayableClip, 'source' | 'tempo'>;

/** Tells apart a Clip's audio as it plays, by its source and its Tempo. */
export function clipAudioKey({ source, tempo }: ClipAudio): string {
  return `${tempo} ${source}`;
}

/** Loads a Clip's audio as it plays on the Timeline, e.g. the player's, which keeps it for playback. */
export type LoadClipAudio = (clip: ClipAudio) => Promise<AudioBuffer>;

// One clock for the whole app, which recording captures on too. Created on
// first use: browsers let it decode right away, and only need a user
// gesture before it plays. Kept across hot updates in development, so a
// hot update doesn't leave the old context running and play on a new one.
export const audioContext: () => AudioContext = hotKept(
  import.meta.hot?.data,
  'audioContext',
  () => new AudioContext(),
);

/**
 * The Clip → Track wiring on an audio context, live or offline: each Clip
 * plays through its Track's gain, which follows the Track's volume, mute
 * and solo, into the context's output. Playback and a Mixdown both build
 * their graph with it.
 */
export class TrackMix {
  #context: BaseAudioContext;
  #gains: Map<number, number>;
  // Each Track's node, created as its first Clip plays.
  #nodes = new Map<number, GainNode>();

  /** Mixes on context, with each Track's gain by id. A Track left out plays as is. */
  constructor(context: BaseAudioContext, gains: Map<number, number>) {
    this.#context = context;
    this.#gains = gains;
  }

  /**
   * Plays part of a Clip's audio on its Track, at the Clip's Gain, shaped by
   * its Fades: from `from` seconds into its source, for duration seconds of
   * the Timeline, starting at context time `at`. Its buffer is its source's
   * audio as the Clip plays it on the Timeline, so a second of the buffer
   * is a second of the Timeline.
   */
  play(buffer: AudioBuffer, clip: PlayableClip, at: number, from: number, duration: number): AudioBufferSourceNode {
    const node = this.#context.createBufferSource();
    node.buffer = buffer;
    const track = this.#track(clip.trackId);
    if (clip.gainFactor === 1 && !clip.fades) {
      node.connect(track);
    } else {
      // Its own gain, let go of with it.
      const gain = this.#context.createGain();
      this.#shape(gain.gain, clip, at, from, duration);
      node.connect(gain).connect(track);
      node.addEventListener('ended', () => gain.disconnect());
    }
    node.start(at, timelineLength(clip, from), duration);
    return node;
  }

  /**
   * Has a Clip's own gain follow its Gain and its Fades, over duration
   * seconds of the Timeline, its audio played from `from` seconds in, at
   * context time `at`.
   */
  #shape(gain: AudioParam, clip: PlayableClip, at: number, from: number, duration: number) {
    if (!clip.fades) {
      gain.value = clip.gainFactor;
      return;
    }
    // Where on the Timeline what's played starts.
    const t = timelineAt(clip, from);
    const { initial, curves } = fadeCurves(clip.fades, t, duration);
    // A curve starting right away starts at the initial gain itself, and
    // nothing else may be set while one runs.
    if (curves[0]?.at !== 0) gain.value = initial * clip.gainFactor;
    for (const c of curves) {
      gain.setValueCurveAtTime(
        c.values.map((v) => v * clip.gainFactor),
        at + c.at,
        c.duration,
      );
    }
  }

  /** Sets each Track's gain by id, heard right away. A Track left out plays as is. */
  setGains(gains: Map<number, number>) {
    this.#gains = gains;
    for (const [trackId, node] of this.#nodes) {
      // Eased over a few milliseconds, so the change doesn't click.
      node.gain.setTargetAtTime(this.#gain(trackId), this.#context.currentTime, 0.01);
    }
  }

  /** Takes each Track's node out of the graph. */
  disconnect() {
    for (const node of this.#nodes.values()) node.disconnect();
    this.#nodes.clear();
  }

  #track(trackId: number): GainNode {
    let node = this.#nodes.get(trackId);
    if (!node) {
      node = this.#context.createGain();
      node.gain.value = this.#gain(trackId);
      node.connect(this.#context.destination);
      this.#nodes.set(trackId, node);
    }
    return node;
  }

  #gain(trackId: number): number {
    return this.#gains.get(trackId) ?? 1;
  }
}

// How far ahead a Loop's repeats are scheduled, and how often, in seconds and
// milliseconds: well clear of timers running late in a busy or hidden tab.
const lookahead = 2;
const scheduleEvery = 500;

export class TimelinePlayer {
  // Each source decoded, and each Clip's audio as it plays, stretched to its
  // Tempo, by clipAudioKey, and those of them ready to play.
  #buffers = new Map<string, Promise<AudioBuffer>>();
  #stretched = new Map<string, Promise<AudioBuffer>>();
  #ready = new Set<string>();
  #nodes = new Set<AudioBufferSourceNode>();
  // Each Track's gain by id, and what applies it while playing.
  #gains = new Map<number, number>();
  #mix: TrackMix | null = null;
  #state: PlayerState = 'stopped';
  // The Timeline position at context time #startedAt; while stopped, the
  // position playback resumes from.
  #from = 0;
  #startedAt = 0;
  // What's playing: its Clips with their decoded audio, and the Loop, if on.
  #playing: { clips: readonly PlayableClip[]; buffers: AudioBuffer[]; loop: Loop | null } | null = null;
  // Up to how long after #startedAt a Loop's repeats are scheduled, and the
  // timer scheduling the next ones.
  #scheduledUntil = 0;
  #timer: ReturnType<typeof setInterval> | undefined;
  // Moves on with every play or stop, so a play still loading when it's
  // superseded never starts.
  #generation = 0;

  constructor(private onState: (state: PlayerState) => void) {}

  get state(): PlayerState {
    return this.#state;
  }

  /**
   * Fetches and decodes a Clip's source, and stretches it to the Clip's
   * Tempo, in the background, once for each source and Tempo.
   */
  load(clip: ClipAudio): Promise<AudioBuffer> {
    const key = clipAudioKey(clip);
    let buffer = this.#stretched.get(key);
    if (!buffer) {
      const decoded = this.#decode(clip.source);
      buffer = stretches(clip) ? decoded.then((d) => stretched(d, clip.tempo)) : decoded;
      buffer.then(
        () => this.#ready.add(key),
        // A failed load is tried again next time.
        () => this.#stretched.delete(key),
      );
      this.#stretched.set(key, buffer);
    }
    return buffer;
  }

  /** Whether a Clip's audio is loaded and stretched, ready to play. */
  ready(clip: ClipAudio): boolean {
    return this.#ready.has(clipAudioKey(clip));
  }

  /** Fetches and decodes a source, once. */
  #decode(source: string): Promise<AudioBuffer> {
    let buffer = this.#buffers.get(source);
    if (!buffer) {
      buffer = fetch(source)
        .then((res) => {
          if (!res.ok) throw new Error(`Couldn't load the audio (${res.status}).`);
          return res.arrayBuffer();
        })
        .then((data) => audioContext().decodeAudioData(data));
      // A failed load is tried again next time.
      buffer.catch(() => this.#buffers.delete(source));
      this.#buffers.set(source, buffer);
    }
    return buffer;
  }

  /** The Timeline position, in seconds. */
  position(): number {
    if (this.#state !== 'playing') return this.#from;
    const elapsed = Math.max(0, audioContext().currentTime - this.#startedAt);
    return positionAt(this.#from, this.#playing?.loop ?? null, elapsed);
  }

  /**
   * The context time at which playback is, or was, at the position it
   * started from, e.g. to line up what's recorded along with it.
   */
  get startedAt(): number {
    return this.#startedAt;
  }

  /** Whether playing goes round a Loop for ever, rather than stopping at the end. */
  get repeating(): boolean {
    return this.#state === 'playing' && repeats(this.#from, this.#playing?.loop ?? null);
  }

  /**
   * Plays clips from a Timeline position, once their audio is decoded, in
   * place of anything else playing, repeating the Loop if one is given and
   * the playhead reaches it. Call it from a user gesture: browsers only let
   * sound start from one.
   */
  async play(clips: readonly PlayableClip[], from: number, loop: Loop | null = null): Promise<void> {
    const context = audioContext();
    // Resumed before anything is awaited, while the gesture still counts.
    const resumed = context.resume();
    this.#silence();
    const generation = ++this.#generation;
    this.#from = from;
    playAlone(this, () => this.stop());
    this.#setState('loading');
    let buffers: AudioBuffer[];
    try {
      await resumed;
      buffers = await Promise.all(clips.map((c) => this.load(c)));
    } catch (e) {
      if (generation === this.#generation) this.#setState('stopped');
      throw e;
    }
    if (generation !== this.#generation) return;

    this.#playing = { clips, buffers, loop };
    this.#mix = new TrackMix(context, this.#gains);
    // A moment ahead, so every Clip is scheduled before the first sounds.
    this.#startedAt = context.currentTime + 0.05;
    this.#scheduledUntil = 0;
    this.#scheduleAhead();
    if (repeats(from, loop)) this.#timer = setInterval(() => this.#scheduleAhead(), scheduleEvery);
    this.#setState('playing');
  }

  /** Schedules what plays next: everything, or a Loop's repeats up to the lookahead. */
  #scheduleAhead() {
    if (!this.#playing || !this.#mix) return;
    const { clips, buffers, loop } = this.#playing;
    const context = audioContext();
    const until = repeats(this.#from, loop) ? context.currentTime - this.#startedAt + lookahead : Infinity;
    const clipIndex = new Map(clips.map((c, i) => [c, i]));
    for (const s of schedule(clips, this.#from, loop, { from: this.#scheduledUntil, to: until })) {
      // Scheduled late, e.g. by a timer held up in a busy tab, a Clip starts
      // where it would be by now, so it stays in time with the clock.
      const late = Math.max(0, context.currentTime - (this.#startedAt + s.delay));
      if (late >= s.duration) continue;
      const buffer = buffers[clipIndex.get(s.clip)!];
      const at = this.#startedAt + s.delay + late;
      const node = this.#mix.play(buffer, s.clip, at, s.from + sourceLength(s.clip, late), s.duration - late);
      // Let go of each once it's played, as a Loop keeps adding more.
      node.onended = () => {
        node.disconnect();
        this.#nodes.delete(node);
      };
      this.#nodes.add(node);
    }
    this.#scheduledUntil = until;
  }

  /** Sets each Track's gain by id, heard right away if playing. A Track left out plays as is. */
  setGains(gains: Map<number, number>) {
    this.#gains = gains;
    this.#mix?.setGains(gains);
  }

  /** Stops playing, keeping the position to resume from. */
  stop() {
    this.#from = this.position();
    this.#generation++;
    this.#silence();
    this.#setState('stopped');
  }

  /** Moves the position while stopped. To move it while playing, play again from there. */
  seek(to: number) {
    if (this.#state === 'stopped') this.#from = to;
  }

  /** Stops playing and lets go of the decoded audio. */
  dispose() {
    this.stop();
    release(this);
    this.#buffers.clear();
    this.#stretched.clear();
    this.#ready.clear();
  }

  #silence() {
    clearInterval(this.#timer);
    this.#playing = null;
    for (const node of this.#nodes) {
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    this.#nodes.clear();
    this.#mix?.disconnect();
    this.#mix = null;
  }

  #setState(state: PlayerState) {
    if (state === this.#state) return;
    this.#state = state;
    this.onState(state);
  }
}

/** Decoded audio stretched to play at a Tempo, as a buffer of its own. */
async function stretched(decoded: AudioBuffer, tempo: number): Promise<AudioBuffer> {
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  const out = await stretch({ channels, sampleRate: decoded.sampleRate }, { tempo });
  const buffer = new AudioBuffer({
    numberOfChannels: out.length,
    length: Math.max(1, out[0].length),
    sampleRate: decoded.sampleRate,
  });
  out.forEach((samples, i) => buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, i));
  return buffer;
}
