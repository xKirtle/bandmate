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
  let seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const parts: string[] = [];
  for (const [unit, size] of units) {
    const n = Math.floor(seconds / size);
    seconds -= n * size;
    // The largest unit, and the one after it.
    if (parts.length > 0 || n > 0) parts.push(n > 0 ? count(n, unit) : '');
    if (parts.length === 2) break;
  }
  const shown = parts.filter(Boolean);
  return shown.length > 0 ? shown.join(' ') : 'less than a minute';
}

/** The server's details for a bug report, with the browser's user agent added. */
export function bugReportDetails(details: string, userAgent: string): string {
  return `${details}\nBrowser: ${userAgent}`;
}
