// What the About page works out in the browser: how long the server has been
// up, and the block Copy details puts on the clipboard.

const units: [string, number][] = [
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

function count(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** How long the server has been up since startedAt: "2 hours 5 minutes", "3 days 4 hours". */
export function uptime(startedAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  // The largest unit there's one of, and the next one down, unless none.
  const largest = units.findIndex(([, size]) => seconds >= size);
  if (largest < 0) return 'less than a minute';
  const [unit, size] = units[largest];
  const shown = [count(Math.floor(seconds / size), unit)];
  const next = units[largest + 1];
  const rest = next ? Math.floor((seconds % size) / next[1]) : 0;
  if (rest > 0) shown.push(count(rest, next[0]));
  return shown.join(' ');
}

/** The server's details for a bug report, with the browser's user agent added. */
export function bugReportDetails(details: string, userAgent: string): string {
  return `${details}\nBrowser: ${userAgent}`;
}
