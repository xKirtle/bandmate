const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday", ... */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** A time rounded to the nearest second, as minutes and two-digit seconds: 65.4 is 1 and "05". */
export function toTheSecond(time: number): { minutes: number; seconds: string } {
  const whole = Math.round(time);
  return { minutes: Math.floor(whole / 60), seconds: String(whole % 60).padStart(2, '0') };
}

/** "3:07" */
export function formatDuration(seconds: number): string {
  const { minutes, seconds: s } = toTheSecond(seconds);
  return `${minutes}:${s}`;
}
