import {
  api,
  type Clip,
  type ClipFades,
  type ClipMove,
  type ClipTakes,
  type CueValue,
  type NewClip,
  type NewTrack,
  type PastedClip,
  type PlacedClip,
  type SongAt,
  type Song,
  type Timeline,
  type TimelineLoop,
  type TrackAt,
  type TrackChanges,
  type TrackToAdd,
} from './api';
import { placementOf } from './clipSource';
import { isBlank, type CuedSong } from './cues';

// Undo and redo for Timeline edits and Cue edits, kept in the browser while
// the page is open, in one history. Each edit is kept as data, with the
// edit that undoes it, worked out from the Timeline, or for a Cue edit the
// Song, before and after it. Undoing and redoing send those through the API
// like any other edit.
//
// A deleted Clip, or a copied one redone, is placed back with its name,
// Gain and Fades, if it has them; a rename is undone by giving the Clip back
// its old name, or a blank one to clear it, and setting its Gain or its
// Fades by setting the old ones back. A trim, or a change to a Clip's Takes,
// can shorten its Fades to fit, so it's undone by setting them back with it.
//
// Clips deleted together are placed back together, as one edit.
//
// An edit that brings back a deleted Clip or Track gets it a new id. The
// edits kept that name the old id are then changed to name the new one.
//
// However a Cue edit was made (typed, nudged, synced or cleared), it's
// undone and redone by restoring the Cues it changed to what they were
// before or after it.
//
// Deleting a Clip of Takes, or its Track, only detaches its Takes, so
// placing a Clip from their ids brings them back. A new Take, a copied
// Clip and pasted Clips are redone as that too, so redoing never uploads a
// Take again or copies it again. A paste that added Tracks is undone by
// deleting them with its Clips, and redone by adding them again with them.
// Likewise, a Sound outlives its last Clip for as long as undo lasts, so an
// imported Sound is undone by deleting its Clip and redone by placing a
// Clip of it back, without uploading it again. A Retake is undone and redone by setting its Clip's Takes, and where they are, as
// they were before or after it, which detaches the new Take or brings it
// back. Deleting Takes, or clearing a
// Clip's inactive ones, is undone the same way, as they're only detached,
// or, if it deleted the Clip with its last Take, by placing the Clip back.
// A nudge is undone the same way, since nudging before the Clip's span
// moves the other Takes in it too, and redone as the nudge, which says
// where the Take goes rather than how far it moves.
//
// A Merge is kept as replacing the Clips it merged with its Clip, which
// plays a Sound, so redoing it never renders or uploads it again. It's
// undone by replacing its Clip with the Clips it merged, as they were, in
// one step, a Clip of Takes getting its Takes back. A Track it added for
// its Clip is deleted with it, and redoing adds it back where it was.
//
// A Split is kept as cutting each Clip, which stays as its left half, and
// adding its right half. It's undone by replacing both halves with the
// Clip as it was, in one step, a Clip of Takes getting its Takes back. It's
// redone by replacing the Clip with both halves as they were, the right
// half's Takes brought back, so redoing never copies Takes again.

/** A change to the Timeline, as the intent sent to the API. */
export type Edit =
  | { kind: 'addBeat'; trackId: number; beatId: number }
  | { kind: 'addTrack'; track: NewTrack }
  | { kind: 'updateTrack'; trackId: number; changes: TrackChanges }
  | { kind: 'reorderTracks'; order: number[] }
  | { kind: 'deleteTrack'; trackId: number }
  | { kind: 'placeClip'; trackId: number; clip: NewClip }
  /** Clips placed at once, some perhaps on Tracks added for them at the bottom. */
  | { kind: 'placeClips'; clips: PlacedClip[]; newTracks?: TrackToAdd[] }
  | { kind: 'duplicateClip'; clipId: number }
  /** Clips pasted from the Clipboard, as new Clips, some perhaps on Tracks added for them at the bottom. */
  | { kind: 'pasteClips'; clips: PastedClip[]; newTracks: TrackToAdd[] }
  | { kind: 'moveClip'; clipId: number; trackId: number; start: number }
  | { kind: 'moveClips'; moves: ClipMove[] }
  /** With fades given, it sets them too, e.g. to undo a trim that shortened them. */
  | { kind: 'trimClip'; clipId: number; offset: number; length: number; fades?: ClipFades }
  /** A blank name clears the Clip's. */
  | { kind: 'renameClip'; clipId: number; name: string }
  /** In dB. */
  | { kind: 'setClipGain'; clipId: number; gain: number }
  /** In seconds; 0 for none. */
  | { kind: 'setClipFades'; clipId: number; fadeIn: number; fadeOut: number }
  | { kind: 'deleteClip'; clipId: number }
  /** Clips deleted at once, and Tracks with them, e.g. those a paste added. */
  | { kind: 'deleteClips'; clipIds: number[]; trackIds?: number[] }
  /**
   * Clips deleted, then Tracks, and others placed in their place, some
   * perhaps on Tracks added for them where they say, in one step, e.g. by a
   * Merge.
   */
  | { kind: 'replaceClips'; clipIds: number[]; clips: PlacedClip[]; trackIds?: number[]; newTracks?: TrackAt[] }
  /** Clips cut in two at a time on the Timeline, in seconds, which crosses each. */
  | { kind: 'splitClips'; clipIds: number[]; at: number }
  | { kind: 'setTakes'; clipId: number; takes: ClipTakes }
  | { kind: 'chooseTake'; clipId: number; takeId: number }
  | { kind: 'nudgeTake'; clipId: number; takeId: number; nudge: number }
  | { kind: 'deleteTake'; clipId: number; takeId: number }
  | { kind: 'clearInactiveTakes'; clipId: number }
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
    this.#undo.push({
      undo: inverse(edit, before, after),
      redo: redoing(edit, before, after),
    });
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
   * Notes that nextUndo's edit was sent, turning before into after, and
   * gives the new ids of the Clips it brought back. A Cue edit leaves the
   * Timeline as it was, so is given it as both.
   */
  undone(before: Timeline, after: Timeline): number[] {
    const entry = this.#undo.pop();
    if (!entry) return [];
    this.#redo.push(entry);
    return this.#follow(entry.undo, before, after);
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

  /**
   * Has every edit kept name the new ids of what a sent step brought back,
   * giving the new ids of the Clips.
   */
  #follow(sent: Step, before: Timeline, after: Timeline): number[] {
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
    return sent.adds.clips.map(ids.clip);
  }
}

/**
 * The step that redoes edit, which turned before into after: itself, but
 * for a copy, a Duplicate, a paste or a Split, placing what it added, so
 * redoing never copies again.
 */
function redoing(edit: Edit, before: Timeline, after: Timeline): Step {
  const adds = added(before, after);
  switch (edit.kind) {
    case 'duplicateClip':
      return { edit: placingAdded(before, after), adds };
    case 'pasteClips':
      return { edit: placingAllAdded(before, after), adds };
    case 'splitClips':
      return splittingAgain(edit.clipIds, before, after);
    default:
      return { edit, adds };
  }
}

/**
 * The step that redoes a Split of the Clips clipIds, which turned before
 * into after: replacing them with both halves of each as they are in
 * after, which all come back with new ids.
 */
function splittingAgain(clipIds: readonly number[], before: Timeline, after: Timeline): Step {
  const halves = new Set([...clipIds, ...added(before, after).clips]);
  const placed = after.tracks.flatMap((track) =>
    track.clips.filter((c) => halves.has(c.id)).map((clip) => ({ track, clip })),
  );
  return {
    edit: {
      kind: 'replaceClips',
      clipIds: [...clipIds],
      clips: placed.map(({ track, clip }) => ({ trackId: track.id, clip: placementOf(clip) })),
    },
    adds: { tracks: [], clips: placed.map(({ clip }) => clip.id) },
  };
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
    case 'placeClips':
    case 'pasteClips': {
      // With any Tracks it added, as one step.
      const { tracks, clips } = added(before, after);
      const trackIds = tracks.length > 0 ? { trackIds: tracks } : {};
      return { edit: { kind: 'deleteClips', clipIds: clips, ...trackIds }, adds: none };
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
    case 'moveClips': {
      const moves = edit.moves.map(({ clipId }) => {
        const { track, clip } = findClip(before, clipId);
        return { clipId, trackId: track.id, start: clip.start };
      });
      return { edit: { kind: 'moveClips', moves }, adds: none };
    }
    case 'trimClip': {
      const { clip } = findClip(before, edit.clipId);
      const { offset, length } = clip;
      const fades = fadesIfAny(clip);
      return { edit: { kind: 'trimClip', clipId: clip.id, offset, length, ...(fades ? { fades } : {}) }, adds: none };
    }
    case 'renameClip': {
      const { clip } = findClip(before, edit.clipId);
      return { edit: { kind: 'renameClip', clipId: clip.id, name: clip.name ?? '' }, adds: none };
    }
    case 'setClipGain': {
      const { clip } = findClip(before, edit.clipId);
      return { edit: { kind: 'setClipGain', clipId: clip.id, gain: clip.gain }, adds: none };
    }
    case 'setClipFades': {
      const { clip } = findClip(before, edit.clipId);
      const { fadeIn, fadeOut } = clip;
      return { edit: { kind: 'setClipFades', clipId: clip.id, fadeIn, fadeOut }, adds: none };
    }
    case 'deleteClip':
      return placingBack(before, edit.clipId);
    case 'deleteClips': {
      const back = placingBackAll(before, edit.clipIds);
      return { edit: { kind: 'placeClips', clips: back.clips }, adds: back.adds };
    }
    case 'replaceClips': {
      // With any Track it added, as one step.
      const back = placingBackAll(before, edit.clipIds);
      const { tracks, clips } = added(before, after);
      const trackIds = tracks.length > 0 ? { trackIds: tracks } : {};
      return { edit: { kind: 'replaceClips', clipIds: clips, ...trackIds, clips: back.clips }, adds: back.adds };
    }
    case 'splitClips': {
      // The Clips are their left halves now.
      const back = placingBackAll(before, edit.clipIds);
      const halves = [...edit.clipIds, ...added(before, after).clips];
      return { edit: { kind: 'replaceClips', clipIds: halves, clips: back.clips }, adds: back.adds };
    }
    case 'setTakes':
    case 'nudgeTake':
    case 'clearInactiveTakes':
      return { edit: settingTakes(before, edit.clipId), adds: none };
    case 'deleteTake':
      // Its last Take deletes the Clip.
      return clipIds(after).has(edit.clipId)
        ? { edit: settingTakes(before, edit.clipId), adds: none }
        : placingBack(before, edit.clipId);
    case 'chooseTake': {
      const { clip } = findClip(before, edit.clipId);
      return { edit: { kind: 'chooseTake', clipId: clip.id, takeId: clip.activeTakeId! }, adds: none };
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

/** The step that places a Clip of before back as it was, after it's deleted. */
function placingBack(before: Timeline, clipId: number): Step {
  const { track, clip } = findClip(before, clipId);
  return {
    edit: { kind: 'placeClip', trackId: track.id, clip: placementOf(clip) },
    adds: { tracks: [], clips: [clip.id] },
  };
}

/** The Clips of before to place back as they were, after they're deleted, in Timeline order, as they come back. */
function placingBackAll(before: Timeline, clipIds: readonly number[]): { clips: PlacedClip[]; adds: Ids } {
  const deleted = new Set(clipIds);
  const back = before.tracks.flatMap((track) =>
    track.clips.filter((c) => deleted.has(c.id)).map((clip) => ({ track, clip })),
  );
  return {
    clips: back.map(({ track, clip }) => ({ trackId: track.id, clip: placementOf(clip) })),
    adds: { tracks: [], clips: back.map(({ clip }) => clip.id) },
  };
}

/**
 * The edit that replaces the Clips a Merge merged, when it turned before
 * into after, with the one Clip it added, as it is, adding back the Track
 * it added for it, if it did, where it was: to keep the Merge in the
 * history, as redoing it places that Clip back, playing its Sound, without
 * rendering or uploading it again.
 */
export function mergingAdded(before: Timeline, after: Timeline, clipIds: readonly number[]): Edit {
  const { tracks, clips } = added(before, after);
  const { track, clip } = findClip(after, clips[0]);
  const placed = { clip: placementOf(clip) };
  if (!tracks.includes(track.id)) {
    return { kind: 'replaceClips', clipIds: [...clipIds], clips: [{ trackId: track.id, ...placed }] };
  }
  const newTrack = { name: track.name, position: after.tracks.indexOf(track) };
  return { kind: 'replaceClips', clipIds: [...clipIds], newTracks: [newTrack], clips: [{ newTrack: 0, ...placed }] };
}

/**
 * The edit that places the one Clip added when before turned into after, as
 * it is: to keep a new Take, an imported Sound or a copied Clip in the
 * history, as redoing them places their Clip back without uploading or
 * copying again. It's undone like any placed Clip, by deleting the Clip,
 * which detaches its Takes.
 */
export function placingAdded(before: Timeline, after: Timeline): Edit {
  const [clipId] = added(before, after).clips;
  const { track, clip } = findClip(after, clipId);
  return { kind: 'placeClip', trackId: track.id, clip: placementOf(clip) };
}

/**
 * The edit that places every Clip added when before turned into after, as
 * it is, as placingAdded does one, adding back any Tracks added for them,
 * which a paste adds at the bottom.
 */
function placingAllAdded(before: Timeline, after: Timeline): Edit {
  const { tracks, clips } = added(before, after);
  const placed: PlacedClip[] = clips.map((id) => {
    const { track, clip } = findClip(after, id);
    const newTrack = tracks.indexOf(track.id);
    return newTrack < 0 ? { trackId: track.id, clip: placementOf(clip) } : { newTrack, clip: placementOf(clip) };
  });
  if (tracks.length === 0) return { kind: 'placeClips', clips: placed };
  const newTracks = tracks.map((id) => ({ name: after.tracks.find((t) => t.id === id)!.name }));
  return { kind: 'placeClips', clips: placed, newTracks };
}

/** The ids of the Clips in after that weren't in before, in Timeline order, e.g. the Clips a paste made. */
export function addedClips(before: Timeline, after: Timeline): number[] {
  return added(before, after).clips;
}

/**
 * The edit that sets a Clip of Takes as it is in tl: its Takes and where
 * they are in its span, its active Take, its placement and its Fades. A Retake is kept
 * in the history as that, so redoing it never uploads its Take again.
 */
export function settingTakes(tl: Timeline, clipId: number): Edit {
  const { clip } = findClip(tl, clipId);
  const { activeTakeId, start, offset, length } = clip;
  const takes = clip.takes.map(({ id, position, nudge }) => ({ id, position, nudge }));
  return { kind: 'setTakes', clipId, takes: { takes, activeTakeId, start, offset, length, ...fadesIfAny(clip) } };
}

/**
 * A Clip's Fades, to set back along with its trim or its Takes, unless it
 * has none: then there were none to shorten.
 */
function fadesIfAny({ fadeIn, fadeOut }: Clip): ClipFades | undefined {
  return fadeIn !== 0 || fadeOut !== 0 ? { fadeIn, fadeOut } : undefined;
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

/** The ids of a Timeline's Clips. */
function clipIds(tl: Timeline): Set<number> {
  return new Set(tl.tracks.flatMap((t) => t.clips.map((c) => c.id)));
}

/** The Tracks and Clips in after that weren't in before. */
function added(before: Timeline, after: Timeline): Ids {
  const tracks = new Set(before.tracks.map((t) => t.id));
  const clips = clipIds(before);
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
    case 'addTrack':
    case 'setLoop':
    case 'switchLoop':
    case 'clearLoop':
      return edit;
    case 'addBeat':
    case 'updateTrack':
      return { ...edit, trackId: ids.track(edit.trackId) };
    case 'reorderTracks':
      return { ...edit, order: edit.order.map(ids.track) };
    case 'deleteTrack':
      return { ...edit, trackId: ids.track(edit.trackId) };
    case 'placeClip':
      return { ...edit, trackId: ids.track(edit.trackId) };
    // Each its own, as their Clips differ.
    case 'placeClips':
      return { ...edit, clips: edit.clips.map((c) => remapOnTrack(c, ids)) };
    case 'pasteClips':
      return { ...edit, clips: edit.clips.map((c) => remapOnTrack(c, ids)) };
    case 'moveClip':
      return { ...edit, clipId: ids.clip(edit.clipId), trackId: ids.track(edit.trackId) };
    case 'moveClips':
      return {
        ...edit,
        moves: edit.moves.map((m) => ({ clipId: ids.clip(m.clipId), trackId: ids.track(m.trackId), start: m.start })),
      };
    case 'splitClips':
      return { ...edit, clipIds: edit.clipIds.map(ids.clip) };
    case 'deleteClips':
      return edit.trackIds
        ? { ...edit, clipIds: edit.clipIds.map(ids.clip), trackIds: edit.trackIds.map(ids.track) }
        : { ...edit, clipIds: edit.clipIds.map(ids.clip) };
    case 'replaceClips': {
      const clips = { clipIds: edit.clipIds.map(ids.clip), clips: edit.clips.map((c) => remapOnTrack(c, ids)) };
      return edit.trackIds ? { ...edit, ...clips, trackIds: edit.trackIds.map(ids.track) } : { ...edit, ...clips };
    }
    case 'trimClip':
    case 'renameClip':
    case 'setClipGain':
    case 'setClipFades':
    case 'duplicateClip':
    case 'deleteClip':
    case 'setTakes':
    case 'chooseTake':
    case 'nudgeTake':
    case 'deleteTake':
    case 'clearInactiveTakes':
      return { ...edit, clipId: ids.clip(edit.clipId) };
  }
}

/** A Clip placed or pasted on one of the Timeline's Tracks naming it by the id given; one on a Track added for it, as it was. */
function remapOnTrack<C extends PlacedClip | PastedClip>(c: C, ids: IdMaps): C {
  return 'trackId' in c ? { ...c, trackId: ids.track(c.trackId) } : c;
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
      return api.addBeatToTimeline(at, edit.trackId, edit.beatId);
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
    case 'placeClips':
      return api.placeClips(at, edit.clips, edit.newTracks);
    case 'pasteClips':
      return api.pasteClips(at, edit.clips, edit.newTracks);
    case 'moveClip':
      return api.moveClip(at, edit.clipId, edit.trackId, edit.start);
    case 'moveClips':
      return api.moveClips(at, edit.moves);
    case 'trimClip':
      return api.trimClip(at, edit.clipId, edit.offset, edit.length, edit.fades);
    case 'renameClip':
      return api.renameClip(at, edit.clipId, edit.name);
    case 'setClipGain':
      return api.setClipGain(at, edit.clipId, edit.gain);
    case 'setClipFades':
      return api.setClipFades(at, edit.clipId, { fadeIn: edit.fadeIn, fadeOut: edit.fadeOut });
    case 'duplicateClip':
      return api.duplicateClip(at, edit.clipId);
    case 'deleteClip':
      return api.deleteClip(at, edit.clipId);
    case 'deleteClips':
      return api.deleteClips(at, edit.clipIds, edit.trackIds);
    case 'replaceClips':
      return api.replaceClips(at, edit.clipIds, edit.clips, edit.trackIds, edit.newTracks);
    case 'splitClips':
      return api.splitClips(at, edit.clipIds, edit.at);
    case 'setTakes':
      return api.setTakes(at, edit.clipId, edit.takes);
    case 'chooseTake':
      return api.chooseTake(at, edit.clipId, edit.takeId);
    case 'nudgeTake':
      return api.nudgeTake(at, edit.clipId, edit.takeId, edit.nudge);
    case 'deleteTake':
      return api.deleteTake(at, edit.clipId, edit.takeId);
    case 'clearInactiveTakes':
      return api.clearInactiveTakes(at, edit.clipId);
    case 'setLoop':
      return api.setLoop(at, edit.loop);
    case 'switchLoop':
      return api.switchLoop(at, edit.on);
    case 'clearLoop':
      return api.clearLoop(at);
  }
}
