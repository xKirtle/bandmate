// Captures the default input on the Timeline's own AudioContext (ADR 0006),
// through an AudioWorklet, so every sample has an exact time on the same
// clock as playback. The browser's echo cancellation, noise suppression and
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

/** The input being captured, from when it's opened until it's stopped. */
export class Capture {
  // The samples received so far, each batch with the frame it starts at.
  #batches: { frame: number; samples: Float32Array }[] = [];
  #stopped: Promise<void>;

  private constructor(
    private context: AudioContext,
    private stream: MediaStream,
    private source: MediaStreamAudioSourceNode,
    private node: AudioWorkletNode,
  ) {
    this.#stopped = new Promise((resolve) => {
      node.port.onmessage = ({ data }) => {
        if (data.done) resolve();
        else this.#batches.push(data);
      };
    });
  }

  /** Opens the default input and starts capturing it. Fails with a CaptureError to show. */
  static async open(context: AudioContext): Promise<Capture> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CaptureError('Recording needs a secure connection: open Bandmate over https or on localhost.');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new CaptureError("Bandmate isn't allowed to use the microphone. Allow it in the browser's site settings.");
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new CaptureError("There's no microphone or audio input to record from.");
      }
      throw new CaptureError(`Couldn't open the microphone (${(e as Error).message}).`);
    }
    try {
      await loadWorklet(context);
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'bandmate-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      source.connect(node);
      // Connected so the browser keeps running it; its output is silent.
      node.connect(context.destination);
      return new Capture(context, stream, source, node);
    } catch (e) {
      for (const track of stream.getTracks()) track.stop();
      throw new CaptureError(`Couldn't start recording (${(e as Error).message}).`);
    }
  }

  /** The rate samples are captured at: the context's, which is the device's. */
  get sampleRate(): number {
    return this.context.sampleRate;
  }

  /**
   * How much later the input captures what's heard than it's played, in
   * seconds, as the browser reports it: its output latency, plus the
   * input's if it says. Calibration will replace this.
   */
  get latency(): number {
    const input = this.stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number };
    return (this.context.outputLatency || 0) + (input?.latency || 0);
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
    const first = Math.round(from * this.context.sampleRate);
    const last = this.#batches.reduce((end, b) => Math.max(end, b.frame + b.samples.length), first);
    const samples = new Float32Array(last - first);
    for (const { frame, samples: batch } of this.#batches) {
      const skip = Math.max(0, first - frame);
      if (skip < batch.length) samples.set(batch.subarray(skip), frame + skip - first);
    }
    this.#batches = [];
    return samples;
  }

  /** Stops capturing without keeping anything, and lets go of the input. */
  close() {
    this.node.port.onmessage = null;
    this.source.disconnect();
    this.node.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
  }
}
