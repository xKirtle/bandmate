// MP3 files, as a Mixdown downloads: encoded with LAME, in plain JavaScript
// (@breezystack/lamejs), a chunk at a time on the main thread, handing it
// back between chunks so progress keeps moving and Cancel keeps working.
import { Mp3Encoder } from '@breezystack/lamejs';
import { pcmSample } from './wav';

/** An MP3's constant bitrate, in kbps. */
export type Mp3Kbps = 320 | 192 | 128;

/** How encoding an MP3 is followed, and cancelled. */
export interface Mp3Encoding {
  /** Cancels it: it then rejects with the signal's reason. */
  signal: AbortSignal;
  /** Hears how far it has got, from 0 to 1, after each chunk. */
  onProgress: (done: number) => void;
}

// LAME encodes 1152 samples a frame: a chunk is a whole number of them,
// about a second at 48 kHz.
const chunkFrames = 1152 * 40;

/**
 * Encodes one or two channels of samples, from -1 to 1, as a constant-bitrate
 * MP3 at sampleRate, each channel as long as the first. Louder samples are
 * clipped, as they would be in a 16-bit WAV.
 */
export async function encodeMp3(
  channels: readonly Float32Array[],
  sampleRate: number,
  kbps: Mp3Kbps,
  { signal, onProgress }: Mp3Encoding,
): Promise<Blob> {
  const length = channels[0]?.length ?? 0;
  const encoder = new Mp3Encoder(channels.length, sampleRate, kbps);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let from = 0; from < length; from += chunkFrames) {
    signal.throwIfAborted();
    const to = Math.min(from + chunkFrames, length);
    const [left, right] = channels.map((samples) => toInt16(samples.subarray(from, to)));
    parts.push(new Uint8Array(encoder.encodeBuffer(left, right)));
    onProgress(to / length);
    await handBack();
  }
  signal.throwIfAborted();
  parts.push(new Uint8Array(encoder.flush()));
  if (length === 0) onProgress(1);
  return new Blob(parts, { type: 'audio/mpeg' });
}

/** Samples as LAME takes them: 16-bit integers. */
function toInt16(samples: Float32Array): Int16Array {
  return Int16Array.from(samples, (s) => pcmSample(s, 16));
}

/**
 * Lets the page get on with things, e.g. drawing progress or hearing Cancel,
 * before carrying on. A message rather than a timeout, which a browser slows
 * to once a second while the tab is in the background.
 */
function handBack(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
