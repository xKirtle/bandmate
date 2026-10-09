// A Clip's Tempo: how fast it plays its audio, without changing its pitch,
// as a ratio of as recorded. It's kept as a ratio, from 0.5 to 2, and typed
// and shown as a whole percentage, e.g. "92%". Plain arithmetic, so the
// Timeline only has to show and set it.

/** A Clip's slowest Tempo, as a ratio. The server checks the same range (MinTempo in the timeline package). */
export const minTempo = 0.5;
/** A Clip's fastest Tempo, as a ratio. */
export const maxTempo = 2;

/** A Tempo as a whole percentage, e.g. 92 for 0.92. */
export function tempoPercent(tempo: number): number {
  return Math.round(tempo * 100);
}

/** The Tempo a percentage typed sets: whole, and kept within the range. */
export function tempoOf(percent: number): number {
  const whole = Math.round(percent);
  return Math.min(tempoPercent(maxTempo), Math.max(tempoPercent(minTempo), whole)) / 100;
}

/** A Tempo as shown, e.g. "92%". */
export function formatTempo(tempo: number): string {
  return `${tempoPercent(tempo)}%`;
}
