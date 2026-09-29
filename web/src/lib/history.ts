import {
  api,
  type CueValue,
  type NewClip,
  type NewTrack,
  type SongAt,
  type Song,
  type Timeline,
  type TimelineLoop,
  type TrackChanges,
} from './api';
import { placementOf } from './clipSource';
import { isBlank, type CuedSong } from './cues';

// Undo and redo for Timeline edits and Cue edits, kept in the browser while
// the page is open, in one history. Each edit is kept as data, with the
// edit that undoes it, worked out from the Timeline, or for a Cue edit the
// Song, before and after it. Undoing and redoing send those through the API
// like any other edit.
//
// An edit that brings back a deleted Clip or Track gets it a new id. The
// edits kept that name the old id are then changed to name the new one.
//
// However a Cue edit was made (typed, nudged, synced or cleared), it's
// undone and redone by restoring the Cues it changed to what they were
// before or after it.
//
// Deleting a Clip of Takes, or its Track, only detaches its Takes, so
// placing a Clip from their ids brings them back. A recording is kept as
// that too, so redoing it never uploads it again.

/** A change to the Timeline, as the intent sent to the API. */
export type Edit =
  | { kind: 'addBeat'; beatId: number }
  | { kind: 'addTrack'; track: NewTrack }
  | { kind: 'updateTrack'; trackId: number; changes: TrackChanges }
  | { kind: 'reorderTracks'; order: number[] }
  | { kind: 'deleteTrack'; trackId: number }
  | { kind: 'placeClip'; trackId: number; clip: NewClip }
  | { kind: 'duplicateClip'; clipId: number }
  | { kind: 'moveClip'; clipId: number; trackId: number; start: number }
  | { kind: 'trimClip'; clipId: number; offset: number; length: number }
  | { kind: 'deleteClip'; clipId: number }
  | { kind: 'setLoop'; loop: TimelineLoop }
  | { kind: 'switchLoop'; on: boolean }
  | { kind: 'clearLoop' };

/** Cues set back to given values, to undo or redo a Cue edit. */
export interface CueEdit {
  kind: 'restoreCues';
  cues: CueValue[];
}

/** An edit kept to undo or redo: to the Timeline, or to the Cues. */
export type HistoryEdit = Edit | CueEdit;

/** Ids of Tracks and Clips, each in Timeline order. */
interface Ids {
  tracks: number[];
  clips: number[];
}

/** An edit to send, and the ids it's known to give what it adds. */
interface Step {
  edit: HistoryEdit;
  adds: Ids;
}

interface Entry {
  undo: Step;
  redo: Step;
}

export class History {
  #undo: Entry[] = [];
  #redo: Entry[] = [];

  /** Keeps an edit that turned before into after, to undo, unless it changed nothing. */
  record(edit: Edit, before: Timeline, after: Timeline): void {
    if (content(before) === content(after)) return;
    this.#undo.push({ undo: inverse(edit, before, after), redo: { edit, adds: added(before, after) } });
    this.#redo = [];
  }

  /** Keeps a Cue edit that turned before into after, to undo, unless it changed no Cue. */
  recordCues(before: CuedSong, after: CuedSong): void {
    const was = cueValues(before);
    const now = cueValues(after);
    // A Cue there on one side only is none on the other.
    const changed = [...new Map([...was, ...now]).values()]
      .map((c) => ({ was: was.get(c.lineId) ?? { ...c, cue: null }, now: now.get(c.lineId) ?? { ...c, cue: null } }))
      .filter((c) => c.was.cue !== c.now.cue);
    if (changed.length === 0) return;
    const none: Ids = { tracks: [], clips: [] };
    this.#undo.push({
      undo: { edit: { kind: 'restoreCues', cues: changed.map((c) => c.was) }, adds: none },
      redo: { edit: { kind: 'restoreCues', cues: changed.map((c) => c.now) }, adds: none },
    });
    this.#redo = [];
  }

  /** The edit that would undo the latest one, or null if there's none. */
  nextUndo(): HistoryEdit | null {
    return this.#undo.at(-1)?.undo.edit ?? null;
  }

  /** The edit that would redo the latest one undone, or null if there's none. */
  nextRedo(): HistoryEdit | null {
    return this.#redo.at(-1)?.redo.edit ?? null;
  }

  /**
   * Notes that nextUndo's edit was sent, turning before into after. A Cue
   * edit leaves the Timeline as it was, so is given it as both.
   */
  undone(before: Timeline, after: Timeline): void {
    const entry = this.#undo.pop();
    if (!entry) return;
    this.#redo.push(entry);
    this.#follow(entry.undo, before, after);
  }

  /** Notes that nextRedo's edit was sent, turning before into after, like undone. */
  redone(before: Timeline, after: Timeline): void {
    const entry = this.#redo.pop();
    if (!entry) return;
    this.#undo.push(entry);
    this.#follow(entry.redo, before, after);
  }

  /** Forgets every edit, e.g. once the Timeline changed elsewhere. */
  clear(): void {
    this.#undo = [];
    this.#redo = [];
  }

  /** Has every edit kept name the new ids of what a sent step brought back. */
  #follow(sent: Step, before: Timeline, after: Timeline) {
    const got = added(before, after);
    const tracks = new Map(sent.adds.tracks.map((id, i) => [id, got.tracks[i]]));
    const clips = new Map(sent.adds.clips.map((id, i) => [id, got.clips[i]]));
    const ids: IdMaps = {
      track: (id) => tracks.get(id) ?? id,
      clip: (id) => clips.get(id) ?? id,
    };
    for (const entry of [...this.#undo, ...this.#redo]) {
      entry.undo = remapStep(entry.undo, ids);
      entry.redo = remapStep(entry.redo, ids);
    }
  }
}

/** The edit that undoes edit, which turned before into after. */
function inverse(edit: Edit, before: Timeline, after: Timeline): Step {
  const none: Ids = { tracks: [], clips: [] };
  switch (edit.kind) {
    case 'addBeat':
    case 'addTrack':
    case 'placeClip':
    case 'duplicateClip': {
      // Deleting a Track it added deletes the Clip it added there too.
      const { tracks, clips } = added(before, after);
      const undo: Edit = tracks.length
        ? { kind: 'deleteTrack', trackId: tracks[0] }
        : { kind: 'deleteClip', clipId: clips[0] };
      return { edit: undo, adds: none };
    }
    case 'updateTrack': {
      const track = before.tracks.find((t) => t.id === edit.trackId)!;
      const changes = Object.fromEntries(Object.keys(edit.changes).map((k) => [k, track[k as keyof TrackChanges]]));
      return { edit: { kind: 'updateTrack', trackId: track.id, changes }, adds: none };
    }
    case 'reorderTracks':
      return { edit: { kind: 'reorderTracks', order: before.tracks.map((t) => t.id) }, adds: none };
    case 'deleteTrack': {
      const position = before.tracks.findIndex((t) => t.id === edit.trackId);
      const { id, name, volume, muted, soloed, clips } = before.tracks[position];
      const track = { name, position, volume, muted, soloed, clips: clips.map(placementOf) };
      return { edit: { kind: 'addTrack', track }, adds: { tracks: [id], clips: clips.map((c) => c.id) } };
    }
    case 'moveClip': {
      const { track, clip } = findClip(before, edit.clipId);
      return { edit: { kind: 'moveClip', clipId: clip.id, trackId: track.id, start: clip.start }, adds: none };
    }
    case 'trimClip': {
      const { clip } = findClip(before, edit.clipId);
      return { edit: { kind: 'trimClip', clipId: clip.id, offset: clip.offset, length: clip.length }, adds: none };
    }
    case 'deleteClip': {
      const { track, clip } = findClip(before, edit.clipId);
      return {
        edit: { kind: 'placeClip', trackId: track.id, clip: placementOf(clip) },
        adds: { tracks: [], clips: [clip.id] },
      };
    }
    case 'switchLoop':
      return { edit: { kind: 'switchLoop', on: !edit.on }, adds: none };
    case 'setLoop':
    case 'clearLoop': {
      const loop = before.loop;
      return { edit: loop ? { kind: 'setLoop', loop: { ...loop } } : { kind: 'clearLoop' }, adds: none };
    }
  }
}

/**
 * The edit a recording made, which turned before into after, to keep in the
 * history: placing its new Clip of Takes, as a redo does without uploading
 * again. It's undone like any placed Clip, by deleting the Clip, which
 * detaches its Take.
 */
export function recorded(before: Timeline, after: Timeline): Edit {
  const [clipId] = added(before, after).clips;
  const { track, clip } = findClip(after, clipId);
  return { kind: 'placeClip', trackId: track.id, clip: placementOf(clip) };
}

/** A Song's Cues by Line id, dormant ones included. */
function cueValues(song: CuedSong): Map<number, CueValue> {
  const values: CueValue[] = song.sections.flatMap((s) =>
    s.alternates.flatMap((a) => a.lines.flatMap((l) => (l.cue === null ? [] : [{ lineId: l.id, cue: l.cue }]))),
  );
  return new Map(values.map((c) => [c.lineId, c]));
}

/**
 * The Cues that can still be restored in a Song: those whose Line is still
 * in it, wherever it is, as the Scrapbook keeps Cues too (ADR 0010), and, to
 * be given a Cue, isn't blank. The rest went with a Lyric Sheet change
 * since, which can't be undone, so they're left out rather than stop undo.
 */
export function restorable(cues: readonly CueValue[], song: CuedSong): CueValue[] {
  const lines = new Map(song.sections.flatMap((s) => s.alternates.flatMap((a) => a.lines.map((l) => [l.id, l]))));
  return cues.filter((c) => {
    const line = lines.get(c.lineId);
    if (!line) return false;
    return c.cue === null || !isBlank(line);
  });
}

/** What an edit can change on a Timeline, to compare. */
function content(tl: Timeline): string {
  return JSON.stringify([tl.tracks, tl.loop]);
}

/** The Tracks and Clips in after that weren't in before. */
function added(before: Timeline, after: Timeline): Ids {
  const tracks = new Set(before.tracks.map((t) => t.id));
  const clips = new Set(before.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  return {
    tracks: after.tracks.map((t) => t.id).filter((id) => !tracks.has(id)),
    clips: after.tracks.flatMap((t) => t.clips.map((c) => c.id)).filter((id) => !clips.has(id)),
  };
}

interface IdMaps {
  track: (id: number) => number;
  clip: (id: number) => number;
}

function remapStep(step: Step, ids: IdMaps): Step {
  return {
    edit: remap(step.edit, ids),
    adds: { tracks: step.adds.tracks.map(ids.track), clips: step.adds.clips.map(ids.clip) },
  };
}

/** An edit naming Tracks and Clips by the ids given. */
function remap(edit: HistoryEdit, ids: IdMaps): HistoryEdit {
  switch (edit.kind) {
    case 'restoreCues':
    case 'addBeat':
    case 'addTrack':
    case 'setLoop':
    case 'switchLoop':
    case 'clearLoop':
      return edit;
    case 'updateTrack':
      return { ...edit, trackId: ids.track(edit.trackId) };
    case 'reorderTracks':
      return { ...edit, order: edit.order.map(ids.track) };
    case 'deleteTrack':
      return { ...edit, trackId: ids.track(edit.trackId) };
    case 'placeClip':
      return { ...edit, trackId: ids.track(edit.trackId) };
    case 'moveClip':
      return { ...edit, clipId: ids.clip(edit.clipId), trackId: ids.track(edit.trackId) };
    case 'trimClip':
    case 'duplicateClip':
    case 'deleteClip':
      return { ...edit, clipId: ids.clip(edit.clipId) };
  }
}

function findClip(tl: Timeline, clipId: number) {
  for (const track of tl.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  throw new Error(`Clip ${clipId} isn't on the Timeline`);
}

/** What a change saved: the Timeline, or for a Cue edit, the Song. */
export type Saved = { timeline: Timeline } | { song: Song };

/** Sends an edit to the Song's Timeline, returning the Timeline it leaves. */
export function sendEdit(at: SongAt, edit: Edit): Promise<Timeline> {
  switch (edit.kind) {
    case 'addBeat':
      return api.addBeatToTimeline(at, edit.beatId);
    case 'addTrack':
      return api.addTrack(at, edit.track);
    case 'updateTrack':
      return api.updateTrack(at, edit.trackId, edit.changes);
    case 'reorderTracks':
      return api.reorderTracks(at, edit.order);
    case 'deleteTrack':
      return api.deleteTrack(at, edit.trackId);
    case 'placeClip':
      return api.placeClip(at, edit.trackId, edit.clip);
    case 'moveClip':
      return api.moveClip(at, edit.clipId, edit.trackId, edit.start);
    case 'trimClip':
      return api.trimClip(at, edit.clipId, edit.offset, edit.length);
    case 'duplicateClip':
      return api.duplicateClip(at, edit.clipId);
    case 'deleteClip':
      return api.deleteClip(at, edit.clipId);
    case 'setLoop':
      return api.setLoop(at, edit.loop);
    case 'switchLoop':
      return api.switchLoop(at, edit.on);
    case 'clearLoop':
      return api.clearLoop(at);
  }
}
