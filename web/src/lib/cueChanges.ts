// A Cue change shows on screen the moment it's made, before the server
// saves it and sends back the Song: the Song shown is the Song as last
// saved with the Cue changes not saved yet made on top, in the order they
// were made. Saves still go one at a time, in that order, so each lands on
// the Song the change was shown on. This makes each change as the server
// does, for the moment until it's saved; the server's Song then replaces it.

import { api, ApiError, type CueValue, type Song, type SongAt } from './api';
import { maxCue, type CuedLine, type CuedSong } from './cues';

/** A change to the Cues, as the intent sent to the API. */
export type CueChange =
  /** A Line's Cue set, in seconds, or cleared with null. */
  | { kind: 'setLineCue'; lineId: number; cue: number | null }
  /** The Cues of all a Section's Lines cleared, dormant ones included. */
  | { kind: 'clearSectionCues'; sectionId: number }
  /** Every Cue in the Song cleared. */
  | { kind: 'clearCues' }
  /** Every Cue from start up to end moved by the seconds given, dormant ones included. */
  | { kind: 'shiftCues'; start: number; end: number; by: number }
  /** Each Cue given set to its value, or cleared. */
  | { kind: 'restoreCues'; cues: CueValue[] };

/** The Song with a Cue change made, as the server would make it; the Song given stays as it was. */
export function withCueChange<S extends CuedSong>(song: S, change: CueChange): S {
  const cue = cueAfter(song, change);
  return {
    ...song,
    sections: song.sections.map((s) => ({
      ...s,
      alternates: s.alternates.map((a) => ({
        ...a,
        lines: a.lines.map((l) => {
          const next = cue(l, s.id);
          return next === l.cue ? l : { ...l, cue: next };
        }),
      })),
    })),
  };
}

/** What a Cue change makes each Line's Cue, given the Line and its Section. */
function cueAfter(song: CuedSong, change: CueChange): (line: CuedLine, section: number) => number | null {
  switch (change.kind) {
    case 'setLineCue':
      return (l) => (l.id === change.lineId ? kept(change.cue) : l.cue);
    case 'clearSectionCues':
      return (l, section) => (section === change.sectionId ? null : l.cue);
    case 'clearCues':
      return () => null;
    case 'restoreCues': {
      const values = new Map(change.cues.map((c) => [c.lineId, kept(c.cue)]));
      return (l) => (values.has(l.id) ? values.get(l.id)! : l.cue);
    }
    case 'shiftCues': {
      // In whole milliseconds, as Cues are kept.
      const [start, end, by] = [change.start, change.end, change.by].map(millis);
      const shifts = (cue: number | null): cue is number => cue !== null && millis(cue) >= start && millis(cue) < end;
      // The server refuses a shift taking any Cue out of the Timeline, by the step as given.
      const all = song.sections.flatMap((s) => s.alternates.flatMap((a) => a.lines.map((l) => l.cue)));
      const out = (cue: number) => millis(cue) / 1000 + change.by < 0 || millis(cue) / 1000 + change.by > maxCue;
      if (all.some((c) => shifts(c) && out(c))) return (l) => l.cue;
      return (l) => (shifts(l.cue) ? (millis(l.cue) + by) / 1000 : l.cue);
    }
  }
}

function millis(seconds: number): number {
  return Math.round(seconds * 1000);
}

/** A Cue as the server keeps it: to the millisecond. */
function kept(cue: number | null): number | null {
  return cue === null ? null : millis(cue) / 1000;
}

/** Whether every Line of two Songs has the same Cue, dormant ones and the Scrapbook's included. */
export function sameCues(a: CuedSong, b: CuedSong): boolean {
  const cues = (s: CuedSong) =>
    JSON.stringify(s.sections.flatMap((x) => x.alternates.flatMap((alt) => alt.lines.map((l) => [l.id, l.cue]))));
  return cues(a) === cues(b);
}

/** Sends a Cue change, returning the Song it leaves. */
export function sendCueChange(at: SongAt, change: CueChange): Promise<Song> {
  switch (change.kind) {
    case 'setLineCue':
      return change.cue === null ? api.clearLineCue(at, change.lineId) : api.setLineCue(at, change.lineId, change.cue);
    case 'clearSectionCues':
      return api.clearSectionCues(at, change.sectionId);
    case 'clearCues':
      return api.clearCues(at);
    case 'shiftCues':
      return api.shiftCues(at, change.start, change.end, change.by);
    case 'restoreCues':
      return api.restoreCues(at, change.cues);
  }
}

/** How long to wait before each try again, in milliseconds: a few seconds in all. */
const retryWaits = [500, 1000, 2000];

/**
 * What a save saved, trying it again quietly for a few seconds while it
 * fails on the network or the server, which may well pass. A refusal, e.g.
 * as the Song changed elsewhere, would only fail again, so it fails at once,
 * as does the last try.
 */
export async function savedRetrying<T>(
  save: () => Promise<T>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<T> {
  for (const ms of retryWaits) {
    try {
      return await save();
    } catch (e) {
      if (!(e instanceof ApiError && (e.status === 0 || e.status >= 500))) throw e;
    }
    await wait(ms);
  }
  return save();
}
