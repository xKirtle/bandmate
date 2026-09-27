import {
  api,
  type CueValue,
  type NewClip,
  type NewTrack,
  type Song,
  type SongAt,
  type Timeline,
  type TimelineLoop,
  type TrackChanges,
} from './api';

// Undo and redo for Timeline edits and Cue edits, in one history kept in the
// browser while the page is open. Each edit is kept as data, with the edit
// that undoes it, worked out from the Timeline, or for a Cue edit the Song,
// before and after it. Undoing and redoing send those through the API like
// any other edit.
//
// An edit that brings back a deleted Clip or Track gets it a new id. The
// edits kept that name the old id are then changed to name the new one.
//
// A Cue edit is undone by restoring the Cues it changed to what they were,
// and redone by restoring them to what it left. Restoring leaves out Cues
// whose Occurrence or Line has gone since, so an undo still works after
// the Lyric Sheet changed.

/** A change to the Timeline, as the intent sent to the API. */
export type TimelineEdit =
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

/** A change to the Song's Cues, as the intent sent to the API. A null cue clears it. */
export type CueEdit =
  | { kind: 'setOccurrenceCue'; occurrenceId: number; cue: number | null }
  | { kind: 'setLineCue'; occurrenceId: number; lineId: number; cue: number | null }
  | { kind: 'clearOccurrenceCues'; occurrenceId: number }
  | { kind: 'clearCues' }
  | { kind: 'restoreCues'; cues: CueValue[] };

export type Edit = TimelineEdit | CueEdit;

const cueKinds = new Set<Edit['kind']>([
  'setOccurrenceCue',
  'setLineCue',
  'clearOccurrenceCues',
  'clearCues',
  'restoreCues',
]);

/** Whether an edit changes the Song's Cues, so leaves a Song rather than a Timeline. */
export function isCueEdit(edit: Edit): edit is CueEdit {
  return cueKinds.has(edit.kind);
}

/** Ids of Tracks and Clips, each in Timeline order. */
interface Ids {
  tracks: number[];
  clips: number[];
}

/** An edit to send, and the ids it's known to give what it adds. */
interface Step {
  edit: Edit;
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
  record(edit: TimelineEdit, before: Timeline, after: Timeline): void;
  record(edit: CueEdit, before: Song, after: Song): void;
  record(edit: Edit, before: Timeline | Song, after: Timeline | Song): void;
  record(edit: Edit, before: Timeline | Song, after: Timeline | Song): void {
    const entry = isCueEdit(edit)
      ? cueEntry(before as Song, after as Song)
      : timelineEntry(edit, before as Timeline, after as Timeline);
    if (!entry) return;
    this.#undo.push(entry);
    this.#redo = [];
  }

  /** The edit that would undo the latest one, or null if there's none. */
  nextUndo(): Edit | null {
    return this.#undo.at(-1)?.undo.edit ?? null;
  }

  /** The edit that would redo the latest one undone, or null if there's none. */
  nextRedo(): Edit | null {
    return this.#redo.at(-1)?.redo.edit ?? null;
  }

  /** Notes that nextUndo's edit was sent, turning before into after. */
  undone(before: Timeline | Song, after: Timeline | Song): void {
    const entry = this.#undo.pop();
    if (!entry) return;
    this.#redo.push(entry);
    this.#follow(entry.undo, before, after);
  }

  /** Notes that nextRedo's edit was sent, turning before into after. */
  redone(before: Timeline | Song, after: Timeline | Song): void {
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
  #follow(sent: Step, before: Timeline | Song, after: Timeline | Song) {
    if (sent.adds.tracks.length === 0 && sent.adds.clips.length === 0) return;
    const got = added(before as Timeline, after as Timeline);
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

const none: Ids = { tracks: [], clips: [] };

/** What to keep for a Timeline edit that turned before into after, or null if it changed nothing. */
function timelineEntry(edit: TimelineEdit, before: Timeline, after: Timeline): Entry | null {
  if (content(before) === content(after)) return null;
  return { undo: inverse(edit, before, after), redo: { edit, adds: added(before, after) } };
}

/** What to keep for a Cue edit that turned before into after, or null if it changed nothing. */
function cueEntry(before: Song, after: Song): Entry | null {
  const redo = cueChanges(before, after);
  if (redo.length === 0) return null;
  return {
    undo: { edit: { kind: 'restoreCues', cues: cueChanges(after, before) }, adds: none },
    redo: { edit: { kind: 'restoreCues', cues: redo }, adds: none },
  };
}

/** The Cues that differ from one Song to another, each at its value in to: each Occurrence's own, then its Lines'. */
function cueChanges(from: Song, to: Song): CueValue[] {
  const was = new Map(from.arrangement.map((o) => [o.id, o]));
  const changed: CueValue[] = [];
  for (const o of to.arrangement) {
    const old = was.get(o.id);
    if ((old?.cue ?? null) !== o.cue) changed.push({ occurrenceId: o.id, cue: o.cue });
    const lines = new Set([...Object.keys(old?.lineCues ?? {}), ...Object.keys(o.lineCues)].map(Number));
    for (const lineId of [...lines].sort((a, b) => a - b)) {
      const cue = o.lineCues[lineId] ?? null;
      if ((old?.lineCues[lineId] ?? null) !== cue) changed.push({ occurrenceId: o.id, lineId, cue });
    }
  }
  return changed;
}

/** The edit that undoes edit, which turned before into after. */
function inverse(edit: TimelineEdit, before: Timeline, after: Timeline): Step {
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
      const track = { name, position, volume, muted, soloed, clips: clips.map(({ id: _, ...placed }) => placed) };
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
      const { id, ...placed } = clip;
      return { edit: { kind: 'placeClip', trackId: track.id, clip: placed }, adds: { tracks: [], clips: [id] } };
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
function remap(edit: Edit, ids: IdMaps): Edit {
  if (isCueEdit(edit)) return edit;
  switch (edit.kind) {
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

/** Sends an edit, returning the Timeline it leaves, or for a Cue edit the Song. */
export function sendEdit(at: SongAt, edit: TimelineEdit): Promise<Timeline>;
export function sendEdit(at: SongAt, edit: CueEdit): Promise<Song>;
export function sendEdit(at: SongAt, edit: Edit): Promise<Timeline | Song>;
export function sendEdit(at: SongAt, edit: Edit): Promise<Timeline | Song> {
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
    case 'setOccurrenceCue':
      return edit.cue === null
        ? api.clearOccurrenceCue(at, edit.occurrenceId)
        : api.setOccurrenceCue(at, edit.occurrenceId, edit.cue);
    case 'setLineCue':
      return edit.cue === null
        ? api.clearLineCue(at, edit.occurrenceId, edit.lineId)
        : api.setLineCue(at, edit.occurrenceId, edit.lineId, edit.cue);
    case 'clearOccurrenceCues':
      return api.clearOccurrenceCues(at, edit.occurrenceId);
    case 'clearCues':
      return api.clearCues(at);
    case 'restoreCues':
      return api.restoreCues(at, edit.cues);
  }
}
