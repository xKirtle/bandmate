// Plays the Timeline: every Clip's audio is fetched, decoded into memory and
// scheduled on one AudioContext, so Tracks stay sample-accurate with each
// other (ADR 0006). Each Track plays through its own gain, which follows its
// volume, mute and solo live.
import { playAlone, release } from './playback';
import { schedule, type Placed } from './schedule';

/** A Clip to play, with where its source's audio is fetched from and the Track it's on. */
export interface PlayableClip extends Placed {
  source: string;
  trackId: number;
}

export type PlayerState = 'stopped' | 'loading' | 'playing';

// One clock for the whole app. Created on first use: browsers let it decode
// right away, and only need a user gesture before it plays.
let shared: AudioContext | null = null;

function audioContext(): AudioContext {
  return (shared ??= new AudioContext());
}

export class TimelinePlayer {
  #buffers = new Map<string, Promise<AudioBuffer>>();
  #nodes: AudioBufferSourceNode[] = [];
  // Each Track's gain by id, and the nodes applying it while playing.
  #gains = new Map<number, number>();
  #trackNodes = new Map<number, GainNode>();
  #state: PlayerState = 'stopped';
  // The Timeline position at context time #startedAt; while stopped, the
  // position playback resumes from.
  #from = 0;
  #startedAt = 0;
  // Moves on with every play or stop, so a play still loading when it's
  // superseded never starts.
  #generation = 0;

  constructor(private onState: (state: PlayerState) => void) {}

  get state(): PlayerState {
    return this.#state;
  }

  /** Fetches and decodes a source in the background, once. */
  load(source: string): Promise<AudioBuffer> {
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
    return this.#from + Math.max(0, audioContext().currentTime - this.#startedAt);
  }

  /**
   * Plays clips from a Timeline position, once their audio is decoded, in
   * place of anything else playing. Call it from a user gesture: browsers
   * only let sound start from one.
   */
  async play(clips: readonly PlayableClip[], from: number): Promise<void> {
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
      buffers = await Promise.all(clips.map((c) => this.load(c.source)));
    } catch (e) {
      if (generation === this.#generation) this.#setState('stopped');
      throw e;
    }
    if (generation !== this.#generation) return;

    const clipIndex = new Map(clips.map((c, i) => [c, i]));
    // A moment ahead, so every Clip is scheduled before the first sounds.
    const at = context.currentTime + 0.05;
    for (const s of schedule(clips, from)) {
      const node = context.createBufferSource();
      node.buffer = buffers[clipIndex.get(s.clip)!];
      node.connect(this.#trackNode(context, s.clip.trackId));
      node.start(at + s.delay, s.from, s.duration);
      this.#nodes.push(node);
    }
    this.#startedAt = at;
    this.#setState('playing');
  }

  /** Sets each Track's gain by id, heard right away if playing. A Track left out plays as is. */
  setGains(gains: Map<number, number>) {
    this.#gains = gains;
    for (const [trackId, node] of this.#trackNodes) {
      // Eased over a few milliseconds, so the change doesn't click.
      node.gain.setTargetAtTime(this.#gain(trackId), node.context.currentTime, 0.01);
    }
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
  }

  #silence() {
    for (const node of this.#nodes) {
      node.stop();
      node.disconnect();
    }
    this.#nodes = [];
    for (const node of this.#trackNodes.values()) node.disconnect();
    this.#trackNodes.clear();
  }

  /** The node a Track's Clips play through, created on first use. */
  #trackNode(context: AudioContext, trackId: number): GainNode {
    let node = this.#trackNodes.get(trackId);
    if (!node) {
      node = context.createGain();
      node.gain.value = this.#gain(trackId);
      node.connect(context.destination);
      this.#trackNodes.set(trackId, node);
    }
    return node;
  }

  #gain(trackId: number): number {
    return this.#gains.get(trackId) ?? 1;
  }

  #setState(state: PlayerState) {
    if (state === this.#state) return;
    this.#state = state;
    this.onState(state);
  }
}
