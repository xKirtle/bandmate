import { api } from './api';

/**
 * Fetches a Beat's waveform, which the Beat list leaves out, and hands it to
 * onPeaks. The returned function drops the answer if it hasn't come yet, e.g.
 * once another Beat or a replaced file needs its own.
 */
export function loadBeatPeaks(id: number, onPeaks: (peaks: number[]) => void): () => void {
  let current = true;
  api.getBeat(id).then(
    (b) => current && onPeaks(b.peaks ?? []),
    // Without peaks the waveform stays flat; the audio still plays.
    () => {},
  );
  return () => {
    current = false;
  };
}
