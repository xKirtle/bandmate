// Every date and time of day the app shows goes through formatDay, formatTime
// or formatWhen, in the browser's time zone: the user's day, wherever the
// server is. How long ago something was, as timeAgo says it, needs no zone.

/** Months as dates show them, spelled out rather than left to the locale, which may shorten September to "Sept". */
const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * A local day in the order the locale puts it, with the month spelled as the
 * app spells it where the locale spells one: "4 Oct 2026", "Oct 4, 2026", "4/10/2026".
 */
function localDay(date: Date, locale: string | undefined, withYear: boolean): string {
  const parts = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: withYear ? 'numeric' : undefined,
  }).formatToParts(date);
  return parts
    .map(({ type, value }) => (type === 'month' && /\D/.test(value) ? shortMonths[date.getMonth()] : value))
    .join('');
}

/** The local day of a time, in the order the locale puts it: "4 Oct 2026" or "Oct 4, 2026". */
export function formatDay(iso: string, locale?: string): string {
  return localDay(new Date(iso), locale, true);
}

/** The local time of day, to the minute, in 12 or 24 hours as the locale counts them: "09:05" or "9:05 AM". */
export function formatTime(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso));
}

/**
 * A local time, to the minute, with its day as near as it is to now:
 * "Today, 09:05", "Yesterday, 23:59", "4 Sep, 14:00", or "31 Dec 2025, 08:30" in another year,
 * the day in the order the locale puts it.
 */
export function formatWhen(iso: string, now = new Date(), locale?: string): string {
  const when = new Date(iso);
  const time = formatTime(iso, locale);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(when, now)) return `Today, ${time}`;
  if (sameDay(when, yesterday)) return `Yesterday, ${time}`;
  return `${localDay(when, locale, when.getFullYear() !== now.getFullYear())}, ${time}`;
}

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
