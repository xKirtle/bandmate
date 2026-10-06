import { describe, expect, it } from 'vitest';
import { bugReportDetails, updateStatus, uptime, ytDlpInUse, ytDlpUpdated } from './about';
import type { ReleasesReport } from './api';

describe('uptime', () => {
  const started = '2026-09-30T08:00:00Z';
  const after = (seconds: number) => Date.parse(started) + seconds * 1000;

  it('is less than a minute at first', () => {
    expect(uptime(started, after(0))).toBe('less than a minute');
    expect(uptime(started, after(59))).toBe('less than a minute');
  });

  it('counts whole minutes, then hours and minutes, then days and hours', () => {
    expect(uptime(started, after(60))).toBe('1 minute');
    expect(uptime(started, after(12 * 60 + 59))).toBe('12 minutes');
    expect(uptime(started, after(3600))).toBe('1 hour');
    expect(uptime(started, after(2 * 3600 + 5 * 60))).toBe('2 hours 5 minutes');
    expect(uptime(started, after(24 * 3600 + 60))).toBe('1 day');
    expect(uptime(started, after(3 * 24 * 3600 + 4 * 3600 + 59 * 60))).toBe('3 days 4 hours');
  });

  it("is less than a minute if the browser's clock is behind the server's", () => {
    expect(uptime(started, after(-30))).toBe('less than a minute');
  });
});

describe('bugReportDetails', () => {
  it("adds the browser's user agent to the server's block", () => {
    const server = 'Bandmate v0.4.0 (1a2b3c4, 2026-09-29)\nGo 1.25.1 linux/amd64 · SQLite 3.50.4 · schema 0027_x';
    expect(bugReportDetails(server, 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0')).toBe(
      'Bandmate v0.4.0 (1a2b3c4, 2026-09-29)\n' +
        'Go 1.25.1 linux/amd64 · SQLite 3.50.4 · schema 0027_x\n' +
        'Browser: Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0',
    );
  });
});

describe('updateStatus', () => {
  const releasesUrl = 'https://github.com/xKirtle/bandmate/releases';
  const latest = { tag: 'v0.5.0', url: releasesUrl + '/tag/v0.5.0' };
  const report = (r: Partial<ReleasesReport>): ReleasesReport => ({
    check: 'ok',
    releasesUrl,
    releases: [],
    ...r,
  });

  it('says a release build is up to date', () => {
    expect(updateStatus(report({ verdict: 'upToDate', latest }))).toEqual({ text: 'Up to date' });
  });

  it('offers a newer release, linking to it', () => {
    expect(updateStatus(report({ verdict: 'updateAvailable', latest }))).toEqual({
      text: 'v0.5.0 available',
      url: latest.url,
    });
  });

  it('names the latest release to a build that is not a release', () => {
    expect(updateStatus(report({ latest }))).toEqual({ text: 'Latest release: v0.5.0', url: latest.url });
  });

  it("says a failed check couldn't check, with the releases page to look at instead", () => {
    expect(updateStatus(report({ check: 'failed' }))).toEqual({
      text: "Couldn't check for updates",
      seeReleases: true,
    });
  });

  it('says nothing when the check is off, or there are no releases yet', () => {
    expect(updateStatus(report({ check: 'off' }))).toBeNull();
    expect(updateStatus(report({}))).toBeNull();
  });
});

describe('ytDlpInUse', () => {
  it("names the yt-dlp in use, and whether it's bundled or updated", () => {
    expect(ytDlpInUse({ version: '2026.08.19', source: 'bundled' })).toBe('yt-dlp 2026.08.19 (bundled)');
    expect(ytDlpInUse({ version: '2026.09.12', source: 'updated' })).toBe('yt-dlp 2026.09.12 (updated)');
  });
});

describe('ytDlpUpdated', () => {
  it('says whether updating changed anything', () => {
    expect(ytDlpUpdated({ outcome: 'upToDate', version: '2026.08.19', source: 'bundled' })).toBe('Already up to date');
    expect(ytDlpUpdated({ outcome: 'updated', version: '2026.09.12', source: 'updated' })).toBe(
      'Updated to 2026.09.12',
    );
  });

  it("says why an update that can't run from the data folder isn't used", () => {
    expect(ytDlpUpdated({ outcome: 'cantRun', version: '2026.08.19', source: 'bundled' })).toBe(
      "Can't run programs from the data folder; mount a newer yt-dlp instead",
    );
  });
});
