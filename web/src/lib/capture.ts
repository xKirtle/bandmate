// Captures the chosen input on the Timeline's own AudioContext (ADR 0006),
// through an AudioWorklet, so every sample has an exact time on the same
// clock as playback. Of an input with several channels, one is kept, since
// Takes are mono. The browser's echo cancellation, noise suppression and
// auto gain are off, so what's kept is what the input delivered, and the
// input is never played back: it goes nowhere but the worklet.

// The worklet keeps the first channel of each block it's given, with the
// frame it started at, and sends them on in batches. Asked to stop, it
// sends what's left and says so, after every batch before it.
const worklet = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blocks = [];
    this.size = 0;
    this.frame = 0;
    this.stopped = false;
    this.port.onmessage = () => {
      this.flush();
      this.stopped = true;
      this.port.postMessage({ done: true });
    };
  }
  flush() {
    if (this.size === 0) return;
    const samples = new Float32Array(this.size);
    let at = 0;
    for (const block of this.blocks) {
      samples.set(block, at);
      at += block.length;
    }
    this.port.postMessage({ frame: this.frame, samples }, [samples.buffer]);
    this.blocks = [];
    this.size = 0;
  }
  process(inputs, outputs) {
    if (this.stopped) return false;
    // Silence while the input has nothing yet, so the frames stay in step.
    const block = inputs[0][0] ? inputs[0][0].slice() : new Float32Array(outputs[0][0].length);
    if (this.size === 0) this.frame = currentFrame;
    this.blocks.push(block);
    this.size += block.length;
    if (this.size >= 4096) this.flush();
    return true;
  }
}
registerProcessor('bandmate-capture', Capture);
`;

import { inputRecorded, resolveInput, type InputChoice } from './inputSettings';

// Added to a context once.
const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

function loadWorklet(context: AudioContext): Promise<void> {
  let done = loaded.get(context);
  if (!done) {
    const url = URL.createObjectURL(new Blob([worklet], { type: 'text/javascript' }));
    done = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    done.catch(() => loaded.delete(context));
    loaded.set(context, done);
  }
  return done;
}

/** Why recording couldn't start, in words to show. */
export class CaptureError extends Error {}

// How many channels to ask an input for: as many as it has, up to this.
const wantedChannels = 8;

/** An input opened, with which of its channels is used. */
export interface OpenInput {
  stream: MediaStream;
  /** How many channels the input has. */
  channels: number;
  /** The channel used, from 0. */
  channel: number;
  /** The name of the device chosen when it isn't connected, so the default is used instead; null otherwise. */
  gone: string | null;
  /** The Input opened: the one chosen, or the one the default is; null where the browser doesn't say. */
  input: InputChoice | null;
}

/**
 * Opens the input chosen, or the default one where it's gone, untouched by
 * the browser's echo cancellation, noise suppression and auto gain. Fails
 * with a CaptureError to show.
 */
export async function openInput(choice: InputChoice): Promise<OpenInput> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CaptureError(insecure);
  const open = (deviceId: string) =>
    navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: { ideal: wantedChannels },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  let stream: MediaStream;
  // Whether the device chosen couldn't be opened, so the default was.
  let fellBack = false;
  try {
    try {
      stream = await open(choice.deviceId);
    } catch (e) {
      // Gone, most likely: the default is tried, and said so below.
      if (!choice.deviceId || (e as DOMException).name !== 'OverconstrainedError') throw e;
      stream = await open('');
      fellBack = true;
    }
  } catch (e) {
    throw new CaptureError(inputError(e as Error));
  }
  const settings = stream.getAudioTracks()[0]?.getSettings();
  const channels = settings?.channelCount || 1;
  // Only once allowed does the browser tell the inputs apart.
  const devices = await listInputs();
  const { channel, gone } = resolveInput(fellBack ? [] : devices, choice, channels);
  const input = inputRecorded(devices, { ...choice, deviceId: gone ? '' : choice.deviceId, channel }, settings);
  return { stream, channels, channel, gone, input };
}

/** The audio inputs the browser lists, or none where it can't. */
async function listInputs(): Promise<MediaDeviceInfo[]> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}

/**
 * The Input recording from a choice would open, as far as can be told
 * without opening it: null where it can't, e.g. for the default input,
 * before the browser allows the microphone.
 */
export async function whichInput(choice: InputChoice): Promise<InputChoice | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return choice.deviceId === '' ? null : choice;
  return inputRecorded(await listInputs(), choice);
}

/**
 * The ids of the audio devices connected, to tell whether an Input's is:
 * null where that can't be told, e.g. before the browser allows the
 * microphone, as it lists no ids till then.
 */
export async function connectedDevices(): Promise<Set<string> | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  const listed = await listInputs();
  // Listed without ids, they're there, but which they are can't be told.
  if (listed.some((d) => d.deviceId === '')) return null;
  return new Set(listed.map((d) => d.deviceId));
}

/** Why an input couldn't be opened, in words to show. */
function inputError(e: Error): string {
  const name = e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return blocked;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return noInput;
  if (name === 'NotReadableError')
    return "The audio input is busy or unavailable. Check it isn't in use by another app.";
  return `Couldn't open the microphone (${e.message}).`;
}

const insecure = 'Recording needs a secure connection: open Bandmate over https or on localhost.';
const blocked = "Bandmate isn't allowed to use the microphone. Allow it in the browser's site settings.";
const noInput = "There's no microphone or audio input to record from. Connect one to record.";

/**
 * Why Record can't work, as far as can be told without asking for the
 * microphone: no secure connection, no inputs, or the microphone blocked.
 * Null when it may well work.
 */
export async function inputProblem(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) return insecure;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (!devices.some((d) => d.kind === 'audioinput')) return noInput;
  } catch {
    // Can't tell.
  }
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    if (status?.state === 'denied') return blocked;
  } catch {
    // Not every browser can say.
  }
  return null;
}

/** Connects the channel used of an input to a node, through a splitter, and returns what to disconnect. */
function connectChannel(context: AudioContext, input: OpenInput, node: AudioNode): AudioNode[] {
  const source = context.createMediaStreamSource(input.stream);
  const splitter = context.createChannelSplitter(input.channels);
  source.connect(splitter);
  splitter.connect(node, input.channel);
  return [source, splitter];
}

/**
 * How much later an input captures what's heard than it's played, in
 * seconds, as the browser reports it: its output latency, plus the input's
 * if it says.
 */
function reportedLatency(context: AudioContext, input: OpenInput): number {
  const settings = input.stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number };
  return (context.outputLatency || 0) + (settings?.latency || 0);
}

/** Lets go of an input. */
function release(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

/** The chosen input's level, from when it's opened until it's closed, e.g. for a meter. */
export class InputLevel {
  #samples: Float32Array<ArrayBuffer>;

  private constructor(
    private context: AudioContext,
    private input: OpenInput,
    private nodes: AudioNode[],
    private analyser: AnalyserNode,
  ) {
    this.#samples = new Float32Array(analyser.fftSize);
  }

  /** Opens the input chosen. Fails with a CaptureError to show. */
  static async open(context: AudioContext, choice: InputChoice): Promise<InputLevel> {
    const input = await openInput(choice);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    return new InputLevel(context, input, connectChannel(context, input, analyser), analyser);
  }

  /** How many channels the input has, and which of them is metered. */
  get channels(): number {
    return this.input.channels;
  }

  get channel(): number {
    return this.input.channel;
  }

  /** The name of the device chosen when it isn't connected, or null. */
  get gone(): string | null {
    return this.input.gone;
  }

  /** The latency the browser reports for the input, in seconds. */
  get latency(): number {
    return reportedLatency(this.context, this.input);
  }

  /** The latest samples of the channel used. */
  samples(): Float32Array {
    this.analyser.getFloatTimeDomainData(this.#samples);
    return this.#samples;
  }

  close() {
    for (const node of this.nodes) node.disconnect();
    release(this.input.stream);
  }
}

/** Samples captured in a batch, with the frame the first was captured at. */
export interface Batch {
  frame: number;
  samples: Float32Array;
}

/** The frame captured at a context time, at a rate. */
export function frameAt(time: number, rate: number): number {
  return Math.round(time * rate);
}

/**
 * The samples captured from a frame on, from batches in any order, with
 * silence wherever none were kept.
 */
export function samplesFrom(batches: readonly Batch[], first: number): Float32Array<ArrayBuffer> {
  const last = batches.reduce((end, b) => Math.max(end, b.frame + b.samples.length), first);
  const samples = new Float32Array(last - first);
  for (const { frame, samples: batch } of batches) {
    const skip = Math.max(0, first - frame);
    if (skip < batch.length) samples.set(batch.subarray(skip), frame + skip - first);
  }
  return samples;
}

/** The input being captured, from when it's opened until it's stopped. */
export class Capture {
  // The samples received so far, each batch with the frame it starts at.
  #batches: Batch[] = [];
  #sink: ((batch: Batch) => void) | null = null;
  #stopped: Promise<void>;

  private constructor(
    private context: AudioContext,
    private input: OpenInput,
    private nodes: AudioNode[],
    private node: AudioWorkletNode,
  ) {
    this.#stopped = new Promise((resolve) => {
      node.port.onmessage = ({ data }) => {
        if (data.done) resolve();
        else {
          this.#batches.push(data);
          this.#sink?.(data);
        }
      };
    });
  }

  /** Opens the input chosen and starts capturing it. Fails with a CaptureError to show. */
  static async open(context: AudioContext, choice: InputChoice): Promise<Capture> {
    const input = await openInput(choice);
    try {
      await loadWorklet(context);
      const node = new AudioWorkletNode(context, 'bandmate-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      const nodes = connectChannel(context, input, node);
      // Connected so the browser keeps running it; its output is silent.
      node.connect(context.destination);
      return new Capture(context, input, nodes, node);
    } catch (e) {
      release(input.stream);
      throw new CaptureError(`Couldn't start recording (${(e as Error).message}).`);
    }
  }

  /** The name of the device chosen when it isn't connected, so the default is captured instead; null otherwise. */
  get gone(): string | null {
    return this.input.gone;
  }

  /** The Input captured: the one chosen, or the one the default is; null where the browser doesn't say. */
  get opened(): InputChoice | null {
    return this.input.input;
  }

  /** The rate samples are captured at: the context's, which is the device's. */
  get sampleRate(): number {
    return this.context.sampleRate;
  }

  /** The latency the browser reports for the input, in seconds; a calibrated Latency Offset replaces it. */
  get latency(): number {
    return reportedLatency(this.context, this.input);
  }

  /** Hands sink every batch captured, those so far and each one after, e.g. to keep a copy. */
  keep(sink: (batch: Batch) => void) {
    for (const batch of this.#batches) sink(batch);
    this.#sink = sink;
  }

  /**
   * Stops capturing, and returns what was captured from context time from
   * on. Lets go of the input.
   */
  async stop(from: number): Promise<Float32Array> {
    this.node.port.postMessage('stop');
    // A stuck worklet shouldn't keep the recording from being saved.
    await Promise.race([this.#stopped, new Promise((resolve) => setTimeout(resolve, 500))]);
    this.close();
    const samples = samplesFrom(this.#batches, frameAt(from, this.context.sampleRate));
    this.#batches = [];
    return samples;
  }

  /** Stops capturing without keeping anything, and lets go of the input. */
  close() {
    this.node.port.onmessage = null;
    this.#sink = null;
    for (const node of this.nodes) node.disconnect();
    this.node.disconnect();
    release(this.input.stream);
  }
}
