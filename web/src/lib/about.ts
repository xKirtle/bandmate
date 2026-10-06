// What About, in Settings, works out in the browser: how long the server
// has been up, the block Copy details puts on the clipboard, how the
// server's releases check reads under the version, and what System
// information's yt-dlp row offers and how its update reads.

import type { ReleasesReport, YtDlpCheck, YtDlpUpdate } from './api';

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

/** The server's details for a bug report, with the yt-dlp in use added to
    its system line once known, and the browser's user agent after. */
export function bugReportDetails(details: string, userAgent: string, ytDlpVersion?: string): string {
  const withYtDlp = ytDlpVersion ? `${details} · yt-dlp ${ytDlpVersion}` : details;
  return `${withYtDlp}\nBrowser: ${userAgent}`;
}

/** The line under the version: the verdict, linking to the release it names
    (url), or that the check failed, when the releases page is the place to
    look instead (seeReleases). */
export type UpdateStatus = { text: string; url?: string; seeReleases?: true };

/** How the server's releases check reads under the version, or null when
    there's nothing to say: the check is off, or there are no releases yet. */
export function updateStatus(r: ReleasesReport): UpdateStatus | null {
  if (r.check === 'failed') return { text: "Couldn't check for updates", seeReleases: true };
  if (r.check !== 'ok' || !r.latest) return null;
  switch (r.verdict) {
    case 'upToDate':
      return { text: 'Up to date' };
    case 'updateAvailable':
      return { text: `${r.latest.tag} available`, url: r.latest.url };
    default:
      return { text: `Latest release: ${r.latest.tag}`, url: r.latest.url };
  }
}

/** What the yt-dlp row offers beside the version: a word on the check
    (status), and the label of its Update button, if it has one. */
export type YtDlpOffer = { status?: string; button?: string };

/** What the yt-dlp row offers, from the check for a newer release: an
    update only when there's one, or a plain one when the check can't say. */
export function ytDlpOffer(c: YtDlpCheck): YtDlpOffer {
  if (c.check === 'failed') return { status: "Couldn't check", button: 'Update' };
  if (c.check !== 'ok' || !c.latest) return { button: 'Update' };
  if (c.verdict === 'updateAvailable') return { button: `Update to ${c.latest.tag}` };
  return { status: 'Up to date' };
}

/** What Update yt-dlp did, in words. */
export function ytDlpUpdated(u: YtDlpUpdate): string {
  switch (u.outcome) {
    case 'upToDate':
      return 'Already up to date';
    case 'updated':
      return `Updated to ${u.version}`;
    case 'cantRun':
      return "Can't run programs from the data folder; mount a newer yt-dlp instead";
  }
}
