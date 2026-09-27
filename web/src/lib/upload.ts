// Prepares an audio file for upload: the browser decodes it the way playback
// will, which checks it can be played and works out its duration and peaks.
// The file itself is uploaded unchanged.
import type { DecodedAudio } from './api';
import { peaks } from './peaks';

/** Thrown when the browser can't decode a file, so it couldn't play it either. */
export class UndecodableError extends Error {
  constructor(fileName: string) {
    super(`“${fileName}” can't be played in this browser. Try an mp3, wav, flac, m4a or ogg file.`);
  }
}

/** Decodes an audio file into its duration and waveform peaks. */
export async function decodeAudio(file: File): Promise<DecodedAudio> {
  // An offline context decodes without asking to play sound.
  const context = new OfflineAudioContext(1, 1, 44100);
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new UndecodableError(file.name);
  }
  if (!(buffer.duration > 0)) throw new UndecodableError(file.name);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return { duration: buffer.duration, peaks: peaks(channels, buffer.sampleRate) };
}

/** "4.2 MB" */
export function formatSize(bytes: number): string {
  const mb = bytes / (1 << 20);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/**
 * Checks a file is small enough to upload and decodes it. Fails with a
 * message to show if it can't be uploaded.
 */
export async function prepareUpload(file: File, maxBytes: number): Promise<DecodedAudio> {
  if (file.size > maxBytes) {
    throw new Error(`“${file.name}” is ${formatSize(file.size)}, over the upload limit of ${formatSize(maxBytes)}.`);
  }
  return decodeAudio(file);
}
