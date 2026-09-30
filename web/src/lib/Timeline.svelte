<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { innerHeight } from 'svelte/reactivity/window';
  import {
    api,
    ApiError,
    type Beat,
    type Clip,
    type Song,
    type SongAt,
    type Timeline,
    type TimelineLoop,
    type Track,
    type TrackChanges,
  } from './api';
  import ActionsMenu from './ActionsMenu.svelte';
  import BeatPicker from './BeatPicker.svelte';
  import { Capture, CaptureError, frameAt, inputProblem } from './capture';
  import { addedTrack, chosenTrack, readChosen, storeChosen, type ChoiceEvent } from './chosenTrack';
  import { clampMove, clampTrimEnd, clampTrimStart, draggedNudge, nudged } from './clipEdit';
  import { activeTake, clipSources, fileStart, playing } from './clipSource';
  import { cuesInSpan, formatCue } from './cues';
  import {
    History,
    placingAdded,
    restorable,
    sendEdit,
    settingTakes,
    type Edit as TimelineEdit,
    type HistoryEdit,
    type Saved,
  } from './history';
  import { formatVolume, maxVolume, silence, trackGains, type Levels } from './mixer';
  import { type MenuAction } from './menu';
  import { peaks as peaksOf, peaksPerSecond } from './peaks';
  import { longPressDelay, pastSlop, type Point } from './press';
  import { recordingPlan, retakeLength, retakePlan, sungPastStart, type RecordingPlan } from './recording';
  import { recoveredPlacement, takesAt, type TakeTarget, type Unsaved } from './recovery';
  import { keptInLoop, outsideLoop, repeats, timelineEnd, type Loop, type Placed } from './schedule';
  import { inTextField } from './textField';
  import { formatDuration } from './time';
  import { tracksDropped, type TrackDrop } from './trackDrag';
  import { TrackDragging } from './trackDragging.svelte';
  import InputSettings from './InputSettings.svelte';
  import CalibrationDialog from './CalibrationDialog.svelte';
  import { appliedOffset, readCalibration, skipCalibration, storeOffset } from './calibration';
  import { readInput } from './inputSettings';
  import {
    clampHeight,
    defaultHeight,
    deviceStorage,
    grownHeight,
    heightBounds,
    readHeight,
    storeHeight,
  } from './timelineHeight';
  import { audioContext, TimelinePlayer, type PlayableClip, type PlayerState } from './timelinePlayer';
  import { forgetUnsaved, Keeper, unsavedSamples, unsavedTakes, whileHeld } from './unsavedTakes';
  import {
    edgeSpeed,
    fitScale,
    follow,
    scrollThumb,
    shownSpan,
    thumbScroll,
    ticks as rulerTicks,
    timeAt as viewTimeAt,
    view as timelineView,
    waveWindow,
    zoom,
    type View,
  } from './timelineView';
  import { encodeWav } from './wav';
  import { barWidth, bars } from './waveform';
  import { clipping, LiveWave, tileBars } from './liveWave';

  // The Timeline, docked under the Lyric Sheet: its Tracks and Clips, and
  // playback with each Track's volume, mute and solo, and the Loop. Editing
  // (adding Beats, adding, renaming, reordering and deleting Tracks, moving,
  // trimming, duplicating and deleting Clips, setting and clearing the Loop,
  // and undoing and redoing all of it along with mixing and Cue edits) is
  // only offered on wider screens; on a phone it only plays, mixes and
  // switches the Loop on and off. On both it zooms and scrolls, and follows
  // the playhead while playing. While the Loop is on, the playhead stays
  // inside it. Recording a Take onto the chosen Track is offered where
  // editing is.
  let {
    song,
    timeline,
    change,
    setBpm,
    onPlayhead,
    onLoop,
    syncing = false,
    onRecording,
    height = $bindable(0),
  }: {
    song: Song;
    timeline: Timeline;
    /** Queues a Timeline change, or a Cue edit; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Saved>) => Promise<boolean>;
    /** Sets the Song's BPM. */
    setBpm: (bpm: number) => void;
    /** Hears where playback is, in seconds, every frame while playing, then null once it stops. */
    onPlayhead?: (at: number | null) => void;
    /** Hears whether the Loop is on, whenever that changes, e.g. to keep Sync mode off while it is. */
    onLoop?: (on: boolean) => void;
    /** Whether the Lyric Sheet is in Sync mode, which recording can't start in. */
    syncing?: boolean;
    /** Hears whether a recording is on, whenever that changes, e.g. to keep Sync mode off while it is. */
    onRecording?: (on: boolean) => void;
    /** How tall the docked Timeline is, in pixels, e.g. for the page to keep clear of it. */
    height?: number;
  } = $props();

  let playerState = $state<PlayerState>('stopped');
  let position = $state(0);
  let error = $state<string | null>(null);
  let collapsed = $state(false);
  let picking = $state(false);
  // A Beat just added whose BPM could become the Song's.
  let offerBpm = $state<{ bpm: number; title: string } | null>(null);
  // After a Clip is moved, moving the Cues it spanned along with it is
  // offered for a few seconds, or until the next edit. Ignoring it leaves
  // them where they were: after recording, they usually belong to the vocal
  // rather than the Beat.
  interface CueOffer {
    start: number;
    end: number;
    by: number;
    count: number;
  }
  // Raw, so the timer can tell whether the offer shown is still its own.
  let offerCues = $state.raw<CueOffer | null>(null);
  let offerTimer: ReturnType<typeof setTimeout> | undefined;
  const offerFor = 8000;

  // Recording a Take onto the chosen Track, at its append point. Playback
  // leads in from a little before it, everything playing as mixed but
  // ignoring the Loop, and runs on until stopped, capturing all along. The
  // lead-in is kept in the Take, hidden behind its Clip's start. Only
  // offered while stopped, and never along with Sync mode.
  //
  // A Retake records the same way into a Clip of Takes, from its start as
  // trimmed, with that Clip kept silent so the old Take isn't sung against.
  //
  // What's captured is kept in the browser as it comes, until the server
  // confirms the upload (see unsavedTakes.ts).
  interface RecordingState {
    phase: 'starting' | 'recording' | 'saving';
    trackId: number | null;
    /** The Clip retaken, or null for a new one. */
    clipId: number | null;
    plan: RecordingPlan | null;
    capture: Capture | null;
    /** The context time playback was at plan.from. */
    startedAt: number;
    /** Where it was going, as kept in the browser. */
    unsaved: Unsaved | null;
    keeper: Keeper | null;
    /** Its waveform so far, from its Clip's start. */
    wave: LiveWave | null;
  }
  let recording = $state.raw<RecordingState | null>(null);
  // Counts the batches the recording's waveform has had, to draw each.
  let waveVersion = $state(0);
  const liveTiles = $derived.by(() => {
    void waveVersion;
    return recording?.wave?.tiles(barWidth / view.scale) ?? [];
  });
  // Whether a recording is capturing, rather than starting or saving.
  const capturing = $derived(recording?.phase === 'recording');
  // Once gone, an input still opening is let go as soon as it opens.
  let destroyed = false;

  // Recordings that never reached the server: left from an earlier visit to
  // this Song, e.g. by a crashed tab, or whose upload just failed. Each is
  // offered back, to keep, placed as it would have been (see recovery.ts),
  // or to discard.
  interface UnsavedOffer {
    /** Its key in the browser, or null where the browser couldn't keep it. */
    id: string | null;
    unsaved: Unsaved;
    sampleRate: number;
    /** Reads back what it captured. */
    samples: () => Promise<Float32Array>;
  }
  let unsaved = $state.raw<UnsavedOffer[]>([]);
  let recovering = $state(false);

  // Peaks by source key, fetched once each, so waveforms show before the
  // audio is decoded.
  let peaks = $state<Record<string, number[]>>({});

  const player = new TimelinePlayer((s) => {
    playerState = s;
    // Also when something else playing stopped it, which stops a recording too.
    if (s === 'stopped') position = player.position();
    if (s === 'stopped' && capturing) stopRecording();
  });
  onDestroy(() => {
    destroyed = true;
    recording?.capture?.close();
    // What was captured so far is offered back on the next visit. One saving
    // is let go of once saved, or not.
    const keeper = recording?.phase === 'recording' ? recording.keeper : null;
    keeper?.finish().then(() => keeper.release());
    player.dispose();
  });

  const sources = $derived(clipSources(timeline));
  const clips = $derived(timeline.tracks.flatMap((t) => t.clips));
  // Each Clip plays the part of its audio file that it holds: a Take's only
  // where it has audio in the Clip. Not the Clip being retaken.
  const playable = $derived<PlayableClip[]>(playing(timeline, sources, recording?.clipId));
  // With Cues but no Clips, it still plays, in silence, for the Lyric Sheet
  // to follow.
  const length = $derived(timelineEnd(clips, song));
  // It shows in full even with nothing on it, and grows while recording.
  const span = $derived(
    shownSpan({ end: length, loopEnd: timeline.loop?.end, recordingAt: capturing ? position : undefined }),
  );
  // Seeking outside the Loop switches it off, and until that's saved,
  // playback already goes on without it.
  let switchingOff = $state(false);
  const loopOn = $derived((timeline.loop?.on ?? false) && !switchingOff);
  // The Loop playback repeats: the saved one, while it's on.
  const playingLoop = $derived<Loop | null>(loopOn ? { start: timeline.loop!.start, end: timeline.loop!.end } : null);
  // Matches the phone layout below, which hides editing.
  const editable = new MediaQuery('min-width: 40.0625rem');

  // Decode in the background, so playing can start right away.
  $effect(() => {
    for (const c of playable) player.load(c.source).catch(() => {});
  });

  $effect(() => {
    for (const s of sources.all()) {
      if (untrack(() => s.key in peaks)) continue;
      peaks[s.key] = [];
      s.loadPeaks().then(
        (p) => (peaks[s.key] = p),
        // Without peaks the Clip stays flat; it still plays.
        () => {},
      );
    }
  });

  // Every edit made here, and every Cue edit (see editCues), is kept to
  // undo, for as long as the page is open. The Timeline is only ever the
  // one the latest edit left, unless a refresh brought in changes made
  // elsewhere: then the edits kept would no longer undo what they did, so
  // they're forgotten.
  const history = new History();
  let undoable = $state(false);
  let redoable = $state(false);
  // The Song version the latest edit here left the Timeline at.
  let editedAt = untrack(() => timeline.version);
  // Edits queued and not yet saved, which undo waits for.
  let queued = 0;

  $effect(() => {
    if (timeline.version === editedAt) return;
    editedAt = timeline.version;
    history.clear();
    showHistory();
  });

  function showHistory() {
    undoable = history.nextUndo() !== null;
    redoable = history.nextRedo() !== null;
  }

  /** Waits for a save, forgetting every edit kept if it's refused because the Song changed elsewhere. */
  async function saved<T>(save: Promise<T>): Promise<T> {
    try {
      return await save;
    } catch (err) {
      if (err instanceof ApiError && err.stale) {
        history.clear();
        showHistory();
      }
      throw err;
    }
  }

  /**
   * Sends an edit, based on the Timeline or Song as it is when its turn
   * comes, and notes in the history what it did.
   */
  async function send(at: SongAt, e: HistoryEdit, note: (before: Timeline, after: Timeline) => void): Promise<Saved> {
    if (e.kind === 'restoreCues') {
      // Cues whose Line is gone since, or can't take one, can't come back. With
      // none left, there's nothing to send, and the step is passed over.
      const cues = restorable(e.cues, song);
      const after = cues.length > 0 ? await saved(api.restoreCues(at, cues)) : song;
      note(timeline, timeline);
      showHistory();
      return { song: after };
    }
    const before = timeline;
    const after = await saved(sendEdit(at, e));
    note(before, after);
    editedAt = after.version;
    showHistory();
    return { timeline: after };
  }

  /**
   * Queues an edit, to undo later, telling done what it did once saved;
   * resolves to whether it succeeded.
   */
  function perform(e: TimelineEdit, done?: (before: Timeline, after: Timeline) => void): Promise<boolean> {
    e = $state.snapshot(e) as TimelineEdit;
    offerCues = null;
    queued++;
    return change((at) =>
      send(at, e, (before, after) => {
        history.record(e, before, after);
        done?.(before, after);
      }),
    ).finally(() => queued--);
  }

  /**
   * Queues a Cue edit, e.g. from the Lyric Sheet, to undo along with the
   * Timeline's edits, in the order they were made; resolves to whether it
   * succeeded.
   */
  export function editCues(op: (at: SongAt) => Promise<Song>): Promise<boolean> {
    offerCues = null;
    queued++;
    return change(async (at) => {
      const before = song;
      const after = await saved(op(at));
      history.recordCues(before, after);
      showHistory();
      return { song: after };
    }).finally(() => queued--);
  }

  function undo() {
    if (!undoable && queued === 0) return;
    offerCues = null;
    change((at) => {
      const e = history.nextUndo();
      return e ? send(at, e, (before, after) => history.undone(before, after)) : unchanged(at);
    });
  }

  function redo() {
    if (!redoable) return;
    offerCues = null;
    change((at) => {
      const e = history.nextRedo();
      return e ? send(at, e, (before, after) => history.redone(before, after)) : unchanged(at);
    });
  }

  /**
   * The Timeline as shown, when there turned out to be nothing to undo or
   * redo, e.g. after pressing the key twice quickly. Nothing is sent, so
   * the Song stays at the version it's at.
   */
  async function unchanged(at: SongAt): Promise<Saved> {
    editedAt = at.version;
    return { timeline: { ...timeline, version: at.version, updatedAt: song.updatedAt } };
  }

  function undoKeys(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'z') return;
    if (event.defaultPrevented || !editable.current || picking || calibrating || inTextField(event.target)) return;
    // Not while recording, which undo would take the place of.
    if (recording) return;
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }

  function keydown(event: KeyboardEvent) {
    if (trackDrag.current && event.key === 'Escape') {
      event.preventDefault();
      trackDrag.cancel();
      return;
    }
    spaceBar(event);
    undoKeys(event);
    recordKey(event);
  }

  // Changes to a Track's levels are shown and heard right away, before
  // they're saved, so a fader follows the hand. Once saved, the Timeline has
  // them.
  let adjusting = $state<Record<number, Partial<Levels>>>({});
  const levels = $derived<Levels[]>(timeline.tracks.map((t) => ({ ...t, ...adjusting[t.id] })));

  $effect(() => player.setGains(trackGains(levels)));

  /** Shows a change to a Track's levels right away, without saving it yet. */
  function preview(track: Track, change: Partial<Levels>) {
    adjusting[track.id] = { ...adjusting[track.id], ...change };
  }

  type LevelChanges = Omit<TrackChanges, 'name'>;

  async function setLevels(track: Track, levelChanges: LevelChanges) {
    preview(track, levelChanges);
    // If it fails, the Track goes back to how it's saved.
    await perform({ kind: 'updateTrack', trackId: track.id, changes: levelChanges });
    // Each value stops being shown over the Timeline's once saved, unless
    // it's been changed again since, e.g. by a fader still being dragged.
    const shown = adjusting[track.id];
    if (!shown) return;
    for (const key of Object.keys(levelChanges) as (keyof LevelChanges)[]) {
      if (shown[key] === levelChanges[key]) delete shown[key];
    }
    if (Object.keys(shown).length === 0) delete adjusting[track.id];
  }

  function volumeInput(track: Track, event: Event) {
    preview(track, { volume: Number((event.currentTarget as HTMLInputElement).value) });
  }

  function volumeChange(track: Track, event: Event) {
    setLevels(track, { volume: Number((event.currentTarget as HTMLInputElement).value) });
  }

  // A Track's name shows as a button that chooses it; its pencil swaps it
  // for a field to rename it in. Until a new name is saved, it's shown.
  let renaming = $state<number | null>(null);
  let naming = $state<Record<number, string>>({});

  function focusField(input: HTMLInputElement) {
    input.focus();
    input.select();
  }

  /** Stops renaming a Track, saving the name typed unless asked not to. */
  function endRename(track: Track, input: HTMLInputElement, save: boolean) {
    if (renaming !== track.id) return;
    renaming = null;
    if (save) rename(track, input.value.trim());
  }

  async function rename(track: Track, name: string) {
    // A Track needs a name, so a blank one leaves it as it was.
    if (!name || name === track.name) return;
    naming[track.id] = name;
    // If it fails, the name goes back to how it's saved.
    await perform({ kind: 'updateTrack', trackId: track.id, changes: { name } });
    if (naming[track.id] === name) delete naming[track.id];
  }

  function nameKey(track: Track, event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    endRename(track, event.currentTarget as HTMLInputElement, event.key === 'Enter');
    // Back to the pencil, where renaming started.
    tick().then(() => document.getElementById(`rename-track-${track.id}`)?.focus());
  }

  /** Moves a Track up or down by one, with its Clips. */
  function shift(index: number, by: -1 | 1) {
    const order = timeline.tracks.map((t) => t.id);
    [order[index], order[index + by]] = [order[index + by], order[index]];
    perform({ kind: 'reorderTracks', order });
  }

  // Dragging a Track by its grip, on desktop and not while recording. A drop
  // saves what as many presses of ↑ or ↓ would, as one edit.
  const trackIds = $derived(timeline.tracks.map((t) => t.id));
  const trackDrag = new TrackDragging(
    () => editable.current && recording === null,
    () => trackIds.join(),
  );
  // The gap between Tracks the dragged one would drop into, if it moves at all.
  const trackGap = $derived(trackDrag.current?.drop?.gap ?? null);

  function dropTrack(drop: TrackDrop) {
    perform({ kind: 'reorderTracks', order: tracksDropped(trackIds, drop) });
  }

  // Deleting a Track doesn't ask first either: it can be undone. A Song
  // always has a Track, so its last one can't go.
  const lastTrack = $derived(timeline.tracks.length === 1);

  function removeTrack(track: Track) {
    if (lastTrack) return;
    perform({ kind: 'deleteTrack', trackId: track.id });
  }

  // A change to what plays is heard right away. The Timeline is replaced
  // after every change to it, so compare what would play, not the objects,
  // and in an order reordering Tracks doesn't change. A Loop switched on,
  // set, adjusted or undone that leaves the playhead outside it takes the
  // playhead to its start, as does opening a Song whose Loop is on.
  const playKey = $derived(
    JSON.stringify([[...playable].sort((a, b) => a.trackId - b.trackId || a.start - b.start), playingLoop]),
  );
  $effect(() => {
    void playKey;
    untrack(() => {
      // A recording plays on as it started, in time with what it captures.
      if (capturing) return;
      const from = playerState === 'stopped' ? position : player.position();
      const to = keptInLoop(from, playingLoop);
      if (playerState !== 'stopped') play(to);
      else if (to !== from) seek(to);
    });
  });

  // Whether playback stopped by reaching the end, keeping the playhead.
  let ended = false;

  /** Lets go of the playhead kept at the end, once it's moved from there. */
  function releaseEnded() {
    if (!ended) return;
    ended = false;
    if (playerState === 'stopped') onPlayhead?.(null);
  }

  // Follow the playhead every frame while playing, and stop at the end,
  // unless going round the Loop.
  $effect(() => {
    // Only stopping lets go of the playhead: starting over from elsewhere
    // (e.g. after an edit) loads for a moment, and keeps it. So does
    // reaching the end, so the last Line stays highlighted, until it's moved.
    if (playerState === 'stopped' && !ended) untrack(() => onPlayhead?.(null));
    if (playerState !== 'playing') return;
    let frame = requestAnimationFrame(function step() {
      if (!dragging) position = player.position();
      onPlayhead?.(position);
      // A recording runs on past the end until it's stopped.
      if (position >= length && !player.repeating && !capturing) {
        ended = true;
        player.stop();
        player.seek(length);
        position = length;
        onPlayhead?.(length);
        return;
      }
      // Not while something's dragged, which would jump with the page.
      if (following && !dragging && !edit && !loopEdit) reveal(position);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  });

  function play(from: number) {
    ended = false;
    error = null;
    player.play(playable, from, playingLoop).catch((e: Error) => (error = e.message));
  }

  function toggle() {
    // Space stops a recording, and does nothing while one starts or saves.
    if (recording) {
      if (capturing) stopRecording();
      return;
    }
    if (playerState !== 'stopped') {
      player.stop();
      position = player.position();
      return;
    }
    following = true;
    // At the end, playing starts over, unless there's a Loop yet to go round.
    play(position >= length && !repeats(position, playingLoop) ? 0 : position);
  }

  /**
   * A time on the Timeline shown, kept on its ruler: past the end too, e.g.
   * to record there, though playback still stops at the end.
   */
  function clamp(t: number): number {
    return Math.max(0, Math.min(span, t));
  }

  function seek(to: number) {
    // A recording plays from where it starts, in time with what it captures.
    if (recording) return;
    position = clamp(to);
    releaseEnded();
    if (playerState === 'stopped') player.seek(position);
    else play(position);
  }

  /** Seeks where asked by hand, switching the Loop off if that's outside it. */
  function seekByHand(to: number) {
    if (recording) return;
    if (outsideLoop(clamp(to), playingLoop)) switchLoopOff();
    seek(to);
  }

  async function switchLoopOff() {
    switchingOff = true;
    // If it fails, the Loop is on again, and takes the playhead back inside.
    await perform({ kind: 'switchLoop', on: false });
    switchingOff = false;
  }

  // Clicking on the ruler seeks. Dragging moves the playhead, and while
  // playing, playback only jumps there on release, so it doesn't stutter.
  // Whether it's outside the Loop is only told on release, too.
  let dragging = false;

  function timeAt(event: Point): number {
    return clamp(spanTimeAt(event.clientX));
  }

  /** The time under a point across the lanes, which may be past the end. */
  function spanTimeAt(clientX: number): number {
    return viewTimeAt(view, xIn(clientX));
  }

  /** How far a point is from the left of the lanes' window, in pixels. */
  function xIn(clientX: number): number {
    return clientX - lanesElement!.getBoundingClientRect().left;
  }

  // Dragging the playhead, a Clip or the Loop near an edge of the lanes
  // scrolls them along, faster the nearer, and what's dragged goes with
  // them. Taking a Clip or the Loop out of view scrolls away from the
  // playhead, so it stops being followed.
  let dragScroll: { at: Point; move: (at: Point) => void } | null = null;
  let dragFrame = 0;

  /** Notes where something's dragged to, scrolling if it's near an edge. */
  function dragAt(at: Point, move: (at: Point) => void) {
    dragScroll = { at: { clientX: at.clientX, clientY: at.clientY }, move };
    if (dragFrame) return;
    let last = performance.now();
    dragFrame = requestAnimationFrame(function step(now) {
      if (!dragScroll) return;
      const speed = edgeSpeed(view, xIn(dragScroll.at.clientX));
      if (speed !== 0) {
        show(timelineView({ ...view, scroll: view.scroll + (speed * (now - last)) / 1000 }));
        if (!dragging) following = false;
        dragScroll.move(dragScroll.at);
      }
      last = now;
      dragFrame = requestAnimationFrame(step);
    });
  }

  function dragDone() {
    dragScroll = null;
    cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }
  onDestroy(dragDone);

  function pointerDown(event: PointerEvent) {
    // A second finger is pinching.
    if (!event.isPrimary) return;
    dragging = true;
    // Clicking the playhead back into view follows it again.
    following = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    seek(timeAt(event));
  }

  function pointerMove(event: Point) {
    if (!dragging) return;
    if (playerState === 'stopped') seek(timeAt(event));
    else position = timeAt(event);
    dragAt(event, pointerMove);
  }

  function pointerUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    dragDone();
    seekByHand(timeAt(event));
  }

  // A drag given up, e.g. for a pinch, isn't a seek. While playing, playback
  // never left where it was; while stopped, a playhead dragged out of the
  // Loop goes back inside it.
  function pointerCancel() {
    if (!dragging) return;
    dragging = false;
    dragDone();
    if (playerState !== 'stopped') return;
    const to = keptInLoop(position, playingLoop);
    if (to !== position) seek(to);
  }

  function rulerKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 15 : 5;
    const to = {
      ArrowLeft: position - step,
      ArrowDown: position - step,
      ArrowRight: position + step,
      ArrowUp: position + step,
      Home: 0,
      End: length,
    }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    seekTo(to);
  }

  /** Seeks as asked by hand, bringing the playhead into view. */
  function seekTo(to: number) {
    following = true;
    seekByHand(to);
    reveal(position);
  }

  /**
   * Plays from a time asked by hand, e.g. leading into a Cue: starts playback
   * there, or jumps there if it's playing already, never pausing it.
   */
  export function playFrom(at: number) {
    seekTo(at);
    if (playerState === 'stopped') play(position);
  }

  /**
   * Whether a space pressed there is its own: typed into a text field,
   * opening a select, or ticking a checkbox or radio, which have no other
   * key. Anywhere else it plays or pauses, even on a button, which a click
   * leaves focused: playing along shouldn't depend on where focus was left.
   */
  function ownsSpace(target: EventTarget | null): boolean {
    if (inTextField(target) || target instanceof HTMLSelectElement) return true;
    if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) return true;
    // Space in a dialog or a ⋯ menu is for what's in it.
    return target instanceof Element && target.closest('dialog, [role="menu"]') !== null;
  }

  function spaceBar(event: KeyboardEvent) {
    if (event.key !== ' ' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.defaultPrevented || picking || calibrating || ownsSpace(event.target)) return;
    // Otherwise the page would scroll.
    event.preventDefault();
    toggle();
  }

  /** Where the playhead is, playing or paused, in seconds to the millisecond, e.g. to cue a Line at. */
  export function playheadAt(): number {
    const at = playerState === 'stopped' ? position : player.position();
    return Math.round(at * 1000) / 1000;
  }

  /** Switches the Loop off, if it's on, e.g. as Sync mode comes on. */
  export function stopLoop() {
    if (loopOn) switchLoopOff();
  }

  // Sync mode and the Loop are exclusive: see the Lyric Sheet.
  $effect(() => {
    onLoop?.(loopOn);
  });

  /** Adds a Beat to the chosen Track, after its last Clip or at 0:00. */
  async function addBeat(beat: Beat) {
    picking = false;
    if (chosen === null) return; // Never: a Song always has a Track.
    const ok = await perform({ kind: 'addBeat', trackId: chosen, beatId: beat.id });
    // Never copied without asking.
    if (ok && song.bpm === null && beat.bpm !== null) offerBpm = { bpm: beat.bpm, title: beat.title };
  }

  function useBpm() {
    if (offerBpm) setBpm(offerBpm.bpm);
    offerBpm = null;
  }

  /** Adds a Track at the bottom and chooses it; resolves to whether it was added. */
  async function addTrack(): Promise<boolean> {
    let added: number | null = null;
    const ok = await perform(
      { kind: 'addTrack', track: { name: `Track ${timeline.tracks.length + 1}` } },
      (before, after) => {
        added = addedTrack(before.tracks, after.tracks);
      },
    );
    // Once the Timeline shows it: until then, it isn't there to choose.
    if (ok && added !== null) choose({ kind: 'add', trackId: added });
    return ok && added !== null;
  }

  // Why Record can't work, where that's known before trying, e.g. no inputs:
  // checked again as inputs come and go.
  let recordProblem = $state<string | null>(null);
  // Said of the input a recording used, e.g. that the one chosen is gone.
  let inputNote = $state<string | null>(null);

  function checkInput() {
    inputProblem().then((p) => (recordProblem = p));
  }

  $effect(() => {
    checkInput();
    const devices = navigator.mediaDevices;
    devices?.addEventListener('devicechange', checkInput);
    let permission: PermissionStatus | undefined;
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((status) => {
        permission = status;
        status.addEventListener('change', checkInput);
      })
      .catch(() => {});
    return () => {
      devices?.removeEventListener('devicechange', checkInput);
      permission?.removeEventListener('change', checkInput);
    };
  });

  // The Latency Offset calibrated on this device, and calibration while it
  // runs: offered before the first recording here, where the Clip to retake
  // waits for it, or run from the recording settings.
  let calibration = $state(readCalibration(deviceStorage()));
  let calibrating = $state<{ offer: boolean; retaking?: Clip } | null>(null);
  // Whether calibration was just skipped, to say where to run it later.
  let skipped = $state(false);

  function storeCalibrated(offset: number) {
    storeOffset(deviceStorage(), offset);
    // Applied even where storage can't keep it, until reload.
    calibration = { offset, offered: true };
  }

  function skipOffer() {
    skipCalibration(deviceStorage());
    calibration = { ...calibration, offered: true };
    skipped = true;
  }

  function calibrationClosed(record: boolean) {
    const { retaking } = calibrating ?? {};
    calibrating = null;
    if (record) startRecording(retaking);
  }

  const canRecord = $derived(
    recording === null && playerState === 'stopped' && !syncing && !calibrating && !recovering && editable.current,
  );

  $effect(() => {
    onRecording?.(recording !== null && recording.phase !== 'saving');
  });

  /**
   * Records a Take onto the chosen Track, or with retaking, into that Clip
   * of Takes.
   */
  async function startRecording(retaking?: Clip) {
    if (!canRecord) return;
    // Calibration is offered first, the first time on this device.
    if (!calibration.offered && calibration.offset === null) {
      calibrating = { offer: true, retaking };
      return;
    }
    error = null;
    // Resumed right away, while the key press or click still counts.
    audioContext()
      .resume()
      .catch(() => {});
    const starting: RecordingState = {
      phase: 'starting',
      trackId: null,
      clipId: retaking?.id ?? null,
      plan: null,
      capture: null,
      startedAt: 0,
      unsaved: null,
      keeper: null,
      wave: null,
    };
    recording = starting;
    inputNote = null;
    try {
      // Said up front where it can be, in place of a recording that fails.
      const trouble = await inputProblem();
      if (trouble) throw new CaptureError(trouble);
      const capture = await Capture.open(audioContext(), readInput(deviceStorage()));
      recording = { ...starting, capture };
      if (capture.gone) inputNote = `${capture.gone} isn't connected, so recording from the default input.`;
      if (destroyed) throw new CaptureError('The Timeline closed before recording started.');
      // Placed once the input's open, in case the Timeline changed meanwhile.
      const target = retaking && timeline.tracks.find((t) => t.clips.some((c) => c.id === retaking.id));
      if (retaking && !target) throw new CaptureError('The Clip to retake is gone.');
      const track = target || (timeline.tracks.find((t) => t.id === chosen) ?? timeline.tracks.at(-1)!);
      const clip = retaking && track.clips.find((c) => c.id === retaking.id)!;
      const plan = clip ? retakePlan(clip) : recordingPlan(track.clips, position);
      following = true;
      ended = false;
      position = plan.from;
      await player.play(playable, plan.from, null);
      if (player.state !== 'playing') throw new CaptureError('Recording stopped before it started.');
      const { startedAt } = player;
      const unsaved: Unsaved = {
        trackId: track.id,
        clipId: starting.clipId,
        takes: clip ? takesAt(clip) : [],
        plan,
        latencyOffset: appliedOffset(calibration, capture.latency),
      };
      const first = frameAt(startedAt, capture.sampleRate);
      const keeper = new Keeper({
        ...unsaved,
        songId: song.id,
        sampleRate: capture.sampleRate,
        first,
        recordedAt: new Date().toISOString(),
      });
      // Drawn from where the Take will be placed: its Clip's start, heard its Latency Offset after it was captured.
      const wave = new LiveWave(first, capture.sampleRate, plan.start - plan.from + unsaved.latencyOffset);
      waveVersion = 0;
      capture.keep((batch) => {
        keeper.add(batch);
        wave.add(batch);
        waveVersion++;
      });
      const { id: trackId } = track;
      recording = { ...starting, phase: 'recording', trackId, plan, capture, startedAt, unsaved, keeper, wave };
    } catch (e) {
      recording?.capture?.close();
      recording = null;
      error = e instanceof CaptureError ? e.message : `Couldn't start recording (${(e as Error).message}).`;
    }
  }

  async function stopRecording() {
    const r = recording;
    if (r?.phase !== 'recording' || !r.capture || !r.plan || r.trackId === null || !r.unsaved || !r.keeper) return;
    recording = { ...r, phase: 'saving' };
    if (playerState !== 'stopped') player.stop();
    position = player.position();
    const samples = await r.capture.stop(r.startedAt);
    const rate = r.capture.sampleRate;
    const { latencyOffset } = r.unsaved;
    // What was sung after the lead-in, placed where it was heard.
    if (!sungPastStart(r.plan, samples.length / rate, latencyOffset)) {
      r.keeper.forget();
      recording = null;
      skipped = false;
      error = 'Recording stopped during the lead-in, so there was nothing to keep.';
      return;
    }
    const { clipId, trackId, plan } = r;
    const target: TakeTarget = clipId === null ? { trackId, start: plan.start } : { clipId };
    const ok = await saveTake(() => ({ target, captureStart: plan.from }), samples, rate, latencyOffset);
    if (ok) r.keeper.forget();
    else {
      // Offered back, to try again or discard.
      const id = await r.keeper.finish();
      r.keeper.release();
      unsaved = [...unsaved, { id, unsaved: r.unsaved, sampleRate: rate, samples: async () => samples }];
    }
    recording = null;
    // Said once, for the recording right after skipping.
    skipped = false;
  }

  /**
   * Uploads a Take recorded, into a Clip of Takes, or in a new Clip on a
   * Track, noting it in the history; resolves to whether it was saved.
   * Where it goes is decided when its turn comes, on the Timeline as it is
   * then.
   */
  function saveTake(
    place: () => { target: TakeTarget | null; captureStart: number },
    samples: Float32Array,
    rate: number,
    latencyOffset: number,
  ): Promise<boolean> {
    const wav = new Blob([encodeWav(samples, rate)], { type: 'audio/wav' });
    const peaks = peaksOf([samples], rate);
    offerCues = null;
    queued++;
    return change(async (at) => {
      const { target, captureStart } = place();
      if (!target) throw new Error("There's no Track to put the Take on.");
      const details = { captureStart, latencyOffset, peaks };
      const before = timeline;
      let after: Timeline;
      if ('clipId' in target) {
        after = await saved(api.retake(at, target.clipId, wav, details));
        history.record(settingTakes(after, target.clipId), before, after);
      } else {
        after = await saved(api.recordTake(at, wav, { ...target, ...details }));
        history.record(placingAdded(before, after), before, after);
      }
      editedAt = after.version;
      showHistory();
      return { timeline: after };
    }).finally(() => queued--);
  }

  $effect(() => {
    const id = songId;
    unsaved = [];
    unsavedTakes(id).then((kept) => {
      if (id !== songId || kept.length === 0) return;
      const offered = kept.map((t) => ({
        id: t.id,
        unsaved: t,
        sampleRate: t.sampleRate,
        samples: () => unsavedSamples(t),
      }));
      // Along with any that failed to upload meanwhile.
      unsaved = [...offered, ...unsaved.filter((o) => !kept.some((t) => t.id === o.id))];
    });
  });

  /** Keeps the unsaved Takes offered, one after another, until one can't be. */
  async function keepUnsaved() {
    if (recovering || recording) return;
    recovering = true;
    error = null;
    try {
      for (const offer of unsaved) {
        if (!(await keepOne(offer))) break;
      }
    } finally {
      recovering = false;
    }
  }

  /** Keeps an unsaved Take; resolves to whether it's no longer offered. */
  async function keepOne(offer: UnsavedOffer): Promise<boolean> {
    let samples: Float32Array;
    try {
      samples = await offer.samples();
    } catch {
      error = "Couldn't read the unsaved Take back from this browser.";
      return false;
    }
    const duration = samples.length / offer.sampleRate;
    const place = () => recoveredPlacement(timeline.tracks, offer.unsaved, duration, chosen);
    const placement = place();
    // Stopped during the lead-in: there's nothing to keep.
    if (placement === null) {
      await dropUnsaved(offer);
      return true;
    }
    // Without Tracks, one's added first, as Record does.
    if (placement.target === null && !(await addTrack())) return false;
    const upload = () => saveTake(() => place()!, samples, offer.sampleRate, offer.unsaved.latencyOffset);
    const ok = offer.id === null ? await upload() : await whileHeld(offer.id, upload);
    if (ok === false) return false;
    // Null where another tab is uploading it already, which drops it once it's done.
    if (ok === null) unsaved = unsaved.filter((o) => o !== offer);
    else await dropUnsaved(offer);
    return true;
  }

  /** Stops offering an unsaved Take, and drops it from the browser. */
  async function dropUnsaved(offer: UnsavedOffer) {
    unsaved = unsaved.filter((o) => o !== offer);
    if (offer.id !== null) await forgetUnsaved(offer.id);
  }

  function discardUnsaved() {
    for (const offer of unsaved) dropUnsaved(offer);
  }

  function switchRecording() {
    if (capturing) stopRecording();
    else startRecording();
  }

  function recordKey(event: KeyboardEvent) {
    if (event.key.toLowerCase() !== 'r' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.defaultPrevented || picking || calibrating || inTextField(event.target)) return;
    if (!capturing && !canRecord) return;
    event.preventDefault();
    switchRecording();
  }

  // The chosen Track, which a recording or a Beat goes to, kept on this
  // device for each Song. Choosing isn't an edit, so it's never saved with
  // the Song.
  // Read again only for another Song: the Song is replaced after every edit.
  const songId = $derived(song.id);
  let remembered = $derived(readChosen(deviceStorage(), songId));
  const chosen = $derived(chosenTrack(timeline.tracks, remembered));

  function choose(event: ChoiceEvent) {
    remembered = chosenTrack(timeline.tracks, remembered, event);
  }

  /**
   * Chooses a Track clicked in its header, but not by its controls (its
   * name, levels, and moving or deleting it) or its grip, which only do
   * their own thing.
   */
  function headClick(event: MouseEvent, track: Track) {
    if (event.target instanceof Element && event.target.closest('input, button, .grip:not(:empty)')) return;
    choose({ kind: 'choose', trackId: track.id });
  }

  // Also the first time, or once the one remembered is gone, so a Track
  // restored below later doesn't become the bottom one chosen.
  $effect(() => {
    if (chosen === null || chosen === untrack(() => remembered)) return;
    remembered = chosen;
  });

  $effect(() => {
    if (remembered !== null) storeChosen(deviceStorage(), songId, remembered);
  });

  // Editing a Clip: dragging its body moves it, along its Track or onto
  // another; dragging an edge trims it. It stops at its neighbours, the
  // source's ends and 0:00 as it goes, and is saved on release. Until the
  // saved Timeline comes back, the Clip is shown where it was dropped.
  interface Edit {
    clip: Clip;
    /** Moving the Clip, trimming either edge, or, Alt+dragged, sliding its active Take within it. */
    mode: 'move' | 'start' | 'end' | 'nudge';
    /** Where the pointer went down, to tell a click or a long press from a drag. */
    from: Point;
    /** How far into the Clip it was grabbed, in seconds. */
    grab: number;
    moved: boolean;
    /** Where the Clip is shown now. */
    trackId: number;
    placement: Placed;
    /** Where its active Take is nudged to, for a nudge. */
    nudge: number;
    saving: boolean;
  }
  let edit = $state<Edit | null>(null);
  let lanesElement = $state<HTMLElement>();
  let lanesWrapElement = $state<HTMLElement>();
  let laneElements = $state<HTMLElement[]>([]);

  /** Each Track's Clips as shown, with the one being edited where it's been dragged to. */
  const shown = $derived(
    timeline.tracks.map((track) => {
      const placed = track.clips
        .filter((c) => c.id !== edit?.clip.id)
        .map((clip) => ({ clip, at: clip as Placed, editing: false }));
      if (edit?.trackId === track.id) {
        const clip = edit.mode === 'nudge' ? nudged(edit.clip, edit.nudge) : edit.clip;
        placed.push({ clip, at: edit.placement, editing: true });
      }
      return { track, clips: placed };
    }),
  );

  function trackOf(clip: Clip) {
    return timeline.tracks.find((t) => t.clips.some((c) => c.id === clip.id))!;
  }

  /** The other Clips on a Track, which the one being edited can't overlap. */
  function othersOn(trackId: number, clip: Clip): Clip[] {
    return timeline.tracks.find((t) => t.id === trackId)!.clips.filter((c) => c.id !== clip.id);
  }

  /** The Track whose lane is nearest to a height on the page. */
  function trackAt(clientY: number): number {
    let best = 0;
    let distance = Infinity;
    // Only the lanes of Tracks there now: a removed Track's may linger.
    timeline.tracks.forEach((_, i) => {
      const lane = laneElements[i];
      if (!lane) return;
      const box = lane.getBoundingClientRect();
      const d = clientY < box.top ? box.top - clientY : clientY > box.bottom ? clientY - box.bottom : 0;
      if (d < distance) [best, distance] = [i, d];
    });
    return timeline.tracks[best].id;
  }

  // The Tracks area's height, dragged by the Timeline's top edge. Null is the
  // default, which follows the window. One dragged on this device is the
  // least this Song's area starts at.
  let chosenHeight = $state<number | null>(readHeight(deviceStorage()));
  let headsHeight = $state(0);
  let lanesHeight = $state(0);
  let resizing: { y: number; height: number } | null = null;
  /** How tall the Tracks and the ruler are, or 0 while unknown (e.g. hidden). */
  const neededHeight = $derived(Math.max(headsHeight, lanesHeight));

  const bounds = $derived.by(() => {
    // One Track and the ruler above it.
    const first = laneElements[0];
    const least = first ? first.offsetTop + first.offsetHeight : 0;
    return heightBounds(innerHeight.current ?? 0, least, neededHeight);
  });

  // A chosen height grows to fit the Tracks as they're known, and as they're
  // added while every one shows. The default already fits them.
  let neededBefore = 0;
  $effect(() => {
    const needed = neededHeight;
    if (!needed) return;
    untrack(() => {
      if (chosenHeight !== null) {
        chosenHeight = grownHeight(chosenHeight, neededBefore, needed, innerHeight.current ?? 0);
      }
    });
    neededBefore = needed;
  });
  const tracksHeight = $derived(clampHeight(chosenHeight ?? defaultHeight(innerHeight.current ?? 0), bounds));

  function resize(height: number) {
    chosenHeight = clampHeight(height, bounds);
  }

  function resizeDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resizing = { y: event.clientY, height: tracksHeight };
  }

  function resizeMove(event: PointerEvent) {
    // Dragging up makes it taller.
    if (resizing) resize(resizing.height + resizing.y - event.clientY);
  }

  function resizeUp() {
    if (!resizing) return;
    resizing = null;
    storeHeight(deviceStorage(), chosenHeight);
  }

  function resizeKey(event: KeyboardEvent) {
    // A Track at a time, however tall the Tracks are drawn.
    const step = laneElements[0]?.offsetHeight ?? 0;
    const by = { ArrowUp: step, ArrowDown: -step }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    resize(tracksHeight + by);
    storeHeight(deviceStorage(), chosenHeight);
  }

  function resetHeight() {
    chosenHeight = null;
    storeHeight(deviceStorage(), null);
  }

  function editDown(event: PointerEvent, clip: Clip, mode: Edit['mode']) {
    if (event.isPrimary && event.button === 0) choose({ kind: 'choose', trackId: trackOf(clip).id });
    if (!editable.current || !event.isPrimary || event.button !== 0 || edit || inClipMenu(event.target)) return;
    event.stopPropagation();
    // Clicking a Clip still focuses it, for its keys and its menu.
    const element = (event.currentTarget as HTMLElement).closest<HTMLElement>('.clip')!;
    element.focus();
    event.preventDefault();
    // A finger held still opens the Clip's menu, as there's no right-click on touch.
    if (event.pointerType === 'touch') pressTimer = setTimeout(() => openClipMenu(clip, element), longPressDelay);
    // Alt+dragging a Clip of Takes slides its active Take, the Clip staying put.
    const take = activeTake(clip);
    edit = {
      clip,
      mode: mode === 'move' && event.altKey && take ? 'nudge' : mode,
      from: { clientX: event.clientX, clientY: event.clientY },
      grab: spanTimeAt(event.clientX) - clip.start,
      moved: false,
      trackId: trackOf(clip).id,
      placement: clip,
      nudge: take?.nudge ?? 0,
      saving: false,
    };
    window.addEventListener('pointermove', editMove);
    window.addEventListener('pointerup', editUp);
    window.addEventListener('pointercancel', editCancel);
  }

  function editMove(event: Point) {
    if (!edit || edit.saving) return;
    // A small wobble while clicking or holding still isn't a drag.
    if (!edit.moved && !pastSlop(edit.from, event)) return;
    edit.moved = true;
    clearTimeout(pressTimer);
    const t = spanTimeAt(event.clientX);
    const { clip } = edit;
    if (edit.mode === 'nudge') {
      edit.nudge = draggedNudge(clip, t - edit.grab - clip.start);
    } else if (edit.mode === 'move') {
      edit.trackId = trackAt(event.clientY);
      const start = clampMove(othersOn(edit.trackId, clip), clip.length, t - edit.grab);
      edit.placement = { ...clip, start };
    } else if (edit.mode === 'start') {
      edit.placement = clampTrimStart(clip, othersOn(edit.trackId, clip), t);
    } else {
      edit.placement = clampTrimEnd(clip, othersOn(edit.trackId, clip), sources.of(clip).duration, t);
    }
    dragAt(event, editMove);
  }

  async function editUp() {
    stopListening();
    if (!edit) return;
    const { clip, trackId, placement: to, mode } = edit;
    if (mode === 'nudge') {
      const takeId = clip.activeTakeId!;
      if (edit.moved && edit.nudge !== activeTake(clip)!.nudge) {
        edit.saving = true;
        await perform({ kind: 'nudgeTake', clipId: clip.id, takeId, nudge: edit.nudge });
      }
      edit = null;
      return;
    }
    const unchanged =
      trackId === trackOf(clip).id && to.start === clip.start && to.offset === clip.offset && to.length === clip.length;
    if (!edit.moved || unchanged) {
      edit = null;
      return;
    }
    edit.saving = true;
    if (mode !== 'move') {
      await perform({ kind: 'trimClip', clipId: clip.id, offset: to.offset, length: to.length });
      edit = null;
      return;
    }
    // Cues are Timeline times and stay put, but those the Clip spanned may
    // belong with it, so moving them along is offered, as a step of its own.
    const found = cuesInSpan(song, clip.start, clip.start + clip.length).length;
    const ok = await perform({ kind: 'moveClip', clipId: clip.id, trackId, start: to.start });
    edit = null;
    if (ok && found > 0 && to.start !== clip.start) {
      offerMove({ start: clip.start, end: clip.start + clip.length, by: to.start - clip.start, count: found });
    }
  }

  function offerMove(offer: CueOffer) {
    offerCues = offer;
    clearTimeout(offerTimer);
    offerTimer = setTimeout(() => {
      if (offerCues === offer) offerCues = null;
    }, offerFor);
  }
  onDestroy(() => clearTimeout(offerTimer));

  function moveCues() {
    if (!offerCues) return;
    const { start, end, by } = offerCues;
    editCues((at) => api.shiftCues(at, start, end, by));
  }

  function editCancel() {
    stopListening();
    if (!edit?.saving) edit = null;
  }

  function stopListening() {
    clearTimeout(pressTimer);
    dragDone();
    window.removeEventListener('pointermove', editMove);
    window.removeEventListener('pointerup', editUp);
    window.removeEventListener('pointercancel', editCancel);
  }
  onDestroy(stopListening);

  function duplicate(clip: Clip) {
    perform({ kind: 'duplicateClip', clipId: clip.id });
  }

  // Deleting doesn't ask first: it can be undone, and the Beat stays in the
  // Beat Library.
  function remove(clip: Clip) {
    perform({ kind: 'deleteClip', clipId: clip.id });
  }

  function clipKey(event: KeyboardEvent, clip: Clip) {
    if (event.target !== event.currentTarget || !editable.current || clip.id === recording?.clipId) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(clip);
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      openClipMenu(clip, event.currentTarget as HTMLElement);
    }
  }

  // Each Clip's menu, opened by its ⋯, right-click, the Menu key, Shift+F10
  // or a long press.
  const clipMenus: Record<number, ActionsMenu> = {};
  // Waiting to open a Clip's menu, until the finger moves or lifts.
  let pressTimer: ReturnType<typeof setTimeout> | undefined;

  function clipActions(clip: Clip): MenuAction[] {
    return [
      // Only while it could start: stopped, and out of Sync mode.
      ...(clip.activeTakeId !== null && canRecord
        ? [{ icon: '●', label: 'Retake', title: 'Record another Take into this Clip', run: () => startRecording(clip) }]
        : []),
      ...takeActions(clip),
      { icon: '⧉', label: 'Duplicate', run: () => duplicate(clip) },
      { icon: '×', label: 'Delete', run: () => remove(clip) },
    ];
  }

  // Choosing, nudging, deleting and clearing Takes don't ask first: they can
  // be undone, and a deleted Take is only detached.
  function takeActions(clip: Clip): MenuAction[] {
    if (clip.activeTakeId === null) return [];
    const { id: clipId, activeTakeId, takes } = clip;
    const active = activeTake(clip)!;
    return [
      {
        icon: '♪',
        label: 'Takes',
        title: 'Choose the Take this Clip plays',
        choices: takes.map((t) => ({
          label: `Take ${t.number}`,
          checked: t.id === activeTakeId,
          run: () => {
            if (t.id !== activeTakeId) perform({ kind: 'chooseTake', clipId, takeId: t.id });
          },
        })),
      },
      {
        icon: '⌫',
        label: 'Delete Take',
        title: takes.length === 1 ? 'Deleting its only Take deletes the Clip' : undefined,
        choices: takes.map((t) => ({
          label: `Take ${t.number}${t.id === activeTakeId ? ' (active)' : ''}`,
          run: () => perform({ kind: 'deleteTake', clipId, takeId: t.id }),
        })),
      },
      {
        icon: '↔',
        label: 'Nudge',
        title: `Move Take ${active.number} within the Clip, in milliseconds, later if positive; or Alt+drag the Clip`,
        field: {
          value: Math.round(active.nudge * 1000),
          unit: 'ms',
          step: 1,
          shiftStep: 10,
          set: (ms) => perform({ kind: 'nudgeTake', clipId, takeId: activeTakeId, nudge: ms / 1000 }),
        },
      },
      ...(takes.length > 1
        ? [{ icon: '⊘', label: 'Clear inactive Takes', run: () => perform({ kind: 'clearInactiveTakes', clipId }) }]
        : []),
      {
        icon: '⤓',
        label: 'Download Take',
        title: `Save Take ${active.number}'s WAV as it was recorded, lead-in and all`,
        run: () => download(api.takeDownloadUrl(timeline.songId, activeTakeId)),
      },
    ];
  }

  /** Saves what a URL serves as a file, as the server names it. */
  function download(url: string) {
    const link = document.createElement('a');
    link.href = url;
    link.download = '';
    link.click();
  }

  /** Whether an event came from a Clip's ⋯ or its open menu, which a Clip's own handlers leave be. */
  function inClipMenu(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('.clip-menu') !== null;
  }

  function openClipMenu(clip: Clip, element: HTMLElement) {
    // Not while a Clip's edit is saving: it's then put back in its place,
    // which would take the menu out of the page under it.
    if (edit?.saving) return;
    // A press that opens the menu isn't a drag.
    if (edit) editCancel();
    // So its ⋯, which the menu lines up with, shows, and focus comes back to the Clip.
    element.focus();
    clipMenus[clip.id]?.openMenu();
  }

  function clipContextMenu(event: MouseEvent, clip: Clip) {
    // The Clip has a menu of its own, in place of the browser's.
    event.preventDefault();
    if (!editable.current || edit?.moved || inClipMenu(event.target)) return;
    openClipMenu(clip, event.currentTarget as HTMLElement);
  }

  // Setting the Loop: dragging along the top of the ruler marks a new one,
  // switched on, and dragging its edges adjusts it. It's saved on release,
  // and until the saved Timeline comes back, shown where it was dropped.
  interface LoopEdit {
    mode: 'new' | 'start' | 'end';
    /** The time the Loop is marked from: where a new one was started, or its edge that isn't dragged. */
    anchor: number;
    /** Where the pointer went down, to tell a click from a drag. */
    fromX: number;
    moved: boolean;
    loop: TimelineLoop;
    saving: boolean;
  }
  let loopEdit = $state<LoopEdit | null>(null);
  const loop = $derived(loopEdit?.moved ? loopEdit.loop : timeline.loop);
  // The shortest Loop the browser sets, in seconds, so a stray click doesn't
  // set one. The server only needs its start before its end.
  const minLoop = 0.25;

  /** The time under a point on the loop bar, within the Timeline shown. */
  function loopTimeAt(clientX: number): number {
    return Math.max(0, Math.min(span, spanTimeAt(clientX)));
  }

  function loopDown(event: PointerEvent) {
    if (!editable.current || !event.isPrimary || event.button !== 0 || loopEdit) return;
    const edge = (event.target as HTMLElement).dataset.edge as 'start' | 'end' | undefined;
    const current = timeline.loop;
    const t = loopTimeAt(event.clientX);
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const common = { fromX: event.clientX, moved: false, saving: false };
    loopEdit =
      edge && current
        ? { ...common, mode: edge, anchor: edge === 'start' ? current.end : current.start, loop: current }
        : { ...common, mode: 'new', anchor: t, loop: { start: t, end: t, on: true } };
  }

  function loopMove(event: Point) {
    if (!loopEdit || loopEdit.saving) return;
    // A small wobble while clicking isn't a drag.
    if (!loopEdit.moved && Math.abs(event.clientX - loopEdit.fromX) < 4) return;
    loopEdit.moved = true;
    const t = loopTimeAt(event.clientX);
    const { mode, anchor, loop: shown } = loopEdit;
    loopEdit.loop =
      mode === 'start'
        ? { ...shown, start: Math.max(0, Math.min(t, anchor - minLoop)) }
        : mode === 'end'
          ? { ...shown, end: Math.max(t, anchor + minLoop) }
          : { ...shown, start: Math.min(anchor, t), end: Math.max(anchor, t) };
    dragAt(event, loopMove);
  }

  async function loopUp() {
    dragDone();
    if (!loopEdit || loopEdit.saving) return;
    const { moved, loop: to } = loopEdit;
    const current = timeline.loop;
    const unchanged = current && to.start === current.start && to.end === current.end && to.on === current.on;
    if (!moved || unchanged || to.end - to.start < minLoop) {
      loopEdit = null;
      return;
    }
    loopEdit.saving = true;
    await perform({ kind: 'setLoop', loop: to });
    loopEdit = null;
  }

  function loopCancel() {
    dragDone();
    if (!loopEdit?.saving) loopEdit = null;
  }

  function switchLoop() {
    if (!timeline.loop) return;
    // Switched off by a seek that's still saving, it's shown off already.
    perform({ kind: 'switchLoop', on: !loopOn });
  }

  function clearLoop() {
    perform({ kind: 'clearLoop' });
  }

  /** A stretch of the Timeline's position and width across it, cut off at its end. */
  function spanStyle(from: number, to: number): { left: string; width: string } {
    return { left: `${percent(from)}%`, width: `${Math.max(0, percent(Math.min(to, span) - from))}%` };
  }

  // Zooming and scrolling: Ctrl+wheel or pinching zooms in and out around
  // the pointer or the pinch, and the lanes scroll along when zoomed in.
  // Zoomed all the way out (scale 0), the whole Timeline fits, however long.
  let scale = $state(0);
  let scroll = $state(0);
  let width = $state(0);
  const view = $derived(timelineView({ span, width, scale, scroll }));
  // Whether the view follows the playhead while playing: until scrolled
  // away from by hand, then again once playing starts or the ruler's clicked.
  // Only read each frame while playing, so it needn't be state.
  let following = true;
  // Where the lanes were last scrolled to from here, to tell scrolling by hand.
  let scrolledTo = 0;

  /** Shows the Timeline zoomed and scrolled as v has it. */
  async function show(v: View) {
    // Zoomed all the way out, it keeps fitting as the Timeline or window changes.
    scale = v.scale > fitScale(v.span, v.width) ? v.scale : 0;
    scroll = scrolledTo = v.scroll;
    // Once the lanes are as wide as zoomed to.
    await tick();
    if (lanesElement) lanesElement.scrollLeft = v.scroll;
  }

  /** Scrolls the playhead into view, if it isn't. */
  function reveal(time: number) {
    // Not while the Timeline's hidden, with no view to scroll.
    if (width === 0) return;
    const next = follow(view, time);
    if (next.scroll !== view.scroll) show(next);
  }

  // The browser's own scroll bar is hidden, as it took height on zooming
  // in and shifted the Timeline. This one lies over the lanes' bottom edge
  // instead, taking none, and shows where the view is along the Timeline.
  // Dragging the thumb or clicking beside it scrolls the lanes by hand, so
  // the playhead stops being followed, as scrolled() tells.
  /** The narrowest the thumb gets, in pixels, to stay easy to grab. */
  const leastThumb = 32;
  const thumb = $derived(scrollThumb(view, leastThumb));
  let barElement = $state<HTMLElement>();
  /** The pointer dragging the thumb, and how far into it it grabbed, in pixels. */
  let thumbDrag = $state<{ pointerId: number; grip: number } | null>(null);

  /** How far a point is from the left of the scroll bar, in pixels. */
  function xInBar(clientX: number): number {
    return clientX - barElement!.getBoundingClientRect().left;
  }

  /** Scrolls the lanes so the thumb starts left pixels along the bar. */
  function scrollThumbTo(left: number) {
    lanesElement!.scrollLeft = thumbScroll(view, leastThumb, left).scroll;
  }

  function thumbDown(event: PointerEvent) {
    // One finger at a time: a second is pinching.
    if (event.button !== 0 || !event.isPrimary || !thumb) return;
    // Not a click on the bar beside it.
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    thumbDrag = { pointerId: event.pointerId, grip: xInBar(event.clientX) - thumb.left };
  }

  function thumbMove(event: PointerEvent) {
    if (event.pointerId !== thumbDrag?.pointerId) return;
    scrollThumbTo(xInBar(event.clientX) - thumbDrag.grip);
  }

  function thumbUp() {
    thumbDrag = null;
  }

  // Zoomed out while dragging, e.g. by pinching, the bar goes and the drag with it.
  $effect(() => {
    if (!thumb) thumbDrag = null;
  });

  /** A click beside the thumb centres it there, and so the view. */
  function barDown(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || !thumb) return;
    scrollThumbTo(xInBar(event.clientX) - thumb.width / 2);
  }

  // Over the bar, the wheel scrolls the lanes as it would over them: the
  // bar isn't in them, so the browser wouldn't. Ctrl+wheel zooms, below.
  function barWheel(event: WheelEvent) {
    if (event.ctrlKey) return;
    const along = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    lanesElement!.scrollLeft += event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? along : along * 33;
  }

  function scrolled() {
    scroll = lanesElement!.scrollLeft;
    // Scrolled by hand, rather than to where it was shown.
    if (Math.abs(scroll - timelineView({ ...view, scroll: scrolledTo }).scroll) > 1) following = false;
    scrolledTo = scroll;
  }

  // Hidden or shown again, the lanes lose where they were scrolled to.
  // Resized, they may need to go back within the Timeline.
  $effect(() => {
    if (!lanesElement || width === 0) return;
    untrack(() => show(view));
  });

  // Once the Timeline fits without zooming out, e.g. after deleting a long
  // Clip, it stays fitted rather than zooming back in as it grows again.
  $effect(() => {
    if (scale > 0 && scale <= fitScale(span, width)) scale = 0;
  });

  function zoomAt(factor: number, clientX: number) {
    show(zoom(view, factor, xIn(clientX)));
  }

  // Listened to directly: Svelte's own wheel and touch listeners are
  // passive, so they can't stop the browser zooming the page instead. On
  // the lanes and the scroll bar over them both.
  $effect(() => {
    const lanes = lanesWrapElement;
    if (!lanes) return;
    const wheel = (event: WheelEvent) => {
      // A trackpad's pinch comes as Ctrl+wheel too.
      if (!event.ctrlKey) return;
      event.preventDefault();
      // A mouse wheel's notch is about 100px, or 3 lines of about 33px:
      // zoomed 1.65x each, however hard it's flicked. A trackpad's pinch
      // comes as many small steps.
      const pixels = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : event.deltaY * 33;
      zoomAt(Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.005), event.clientX);
    };
    let pinch: { distance: number; x: number } | null = null;
    const pinchOf = ({ touches: [a, b] }: TouchEvent) => ({
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      x: (a.clientX + b.clientX) / 2,
    });
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      pinch = pinchOf(event);
      // The first finger may have started dragging the playhead, the Loop or the thumb.
      thumbDrag = null;
      dragging = false;
      dragDone();
      loopCancel();
    };
    const touchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const now = pinchOf(event);
      // Zoomed around the pinch, and moved along with it.
      const zoomed = zoom(view, now.distance / pinch.distance, xIn(now.x));
      show(timelineView({ ...zoomed, scroll: zoomed.scroll - (now.x - pinch.x) }));
      pinch = now;
    };
    const touchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = null;
    };
    lanes.addEventListener('wheel', wheel, { passive: false });
    lanes.addEventListener('touchstart', touchStart);
    lanes.addEventListener('touchmove', touchMove, { passive: false });
    lanes.addEventListener('touchend', touchEnd);
    lanes.addEventListener('touchcancel', touchEnd);
    return () => {
      lanes.removeEventListener('wheel', wheel);
      lanes.removeEventListener('touchstart', touchStart);
      lanes.removeEventListener('touchmove', touchMove);
      lanes.removeEventListener('touchend', touchEnd);
      lanes.removeEventListener('touchcancel', touchEnd);
    };
  });

  const ticks = $derived(rulerTicks(view));

  /** Where a time falls across the Timeline's whole width, in percent. */
  function percent(time: number): number {
    return span > 0 ? (time / span) * 100 : 0;
  }

  /**
   * A stretch of the waveform of what a Clip plays, from offset seconds in,
   * as count bars over drawn seconds. Past heard seconds in, trimmed off
   * the Clip, it's silent.
   */
  function clipShape(clip: Clip, offset: number, heard: number, drawn: number, count: number): number[] {
    const all = peaks[sources.of(clip).key] ?? [];
    // The audio file starts this far into the source, silent before it.
    const lead = Math.round(fileStart(clip) * peaksPerSecond);
    const from = Math.floor(offset * peaksPerSecond);
    const to = Math.max(from, Math.min(Math.ceil((offset + heard) * peaksPerSecond), lead + all.length));
    const kept = Array.from({ length: to - from }, (_, i) => all[from + i - lead] ?? 0);
    const silent = Math.max(0, Math.ceil((offset + drawn) * peaksPerSecond) - to);
    return bars([...kept, ...new Array<number>(silent).fill(0)], count);
  }
</script>

<!-- A tab closing mid-recording writes what it hasn't yet, to offer it back. -->
<svelte:window onkeydown={keydown} onpagehide={() => recording?.keeper?.finish()} />

{#snippet undoRedo()}
  <span class="history edit-only">
    <button type="button" class="icon" onclick={undo} disabled={!undoable} aria-label="Undo" title="Undo (Ctrl+Z)"
      >↶</button
    >
    <button type="button" class="icon" onclick={redo} disabled={!redoable} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"
      >↷</button
    >
  </span>
{/snippet}

<section class="timeline" aria-label="Timeline" bind:offsetHeight={height}>
  {#if !collapsed}
    <!-- A focusable separator with a value is a widget, resized with Up and Down. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="resize"
      role="separator"
      tabindex="0"
      aria-orientation="horizontal"
      aria-controls="timeline-tracks"
      aria-label="Resize the Timeline"
      aria-valuemin={Math.round(bounds.min)}
      aria-valuemax={Math.round(bounds.max)}
      aria-valuenow={Math.round(tracksHeight)}
      title="Drag to resize the Timeline (double-click to reset)"
      onpointerdown={resizeDown}
      onpointermove={resizeMove}
      onpointerup={resizeUp}
      onpointercancel={resizeUp}
      onkeydown={resizeKey}
      ondblclick={resetHeight}
    ></div>
  {/if}
  <div class="inner">
    <div class="transport">
      <button
        type="button"
        class="play"
        onclick={toggle}
        aria-label={playerState === 'stopped' ? 'Play' : 'Pause'}
        title="Play or pause (Space)"
      >
        {#if playerState === 'stopped'}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
        {/if}
      </button>
      <span class="time muted">{formatDuration(position)} / {formatDuration(length)}</span>
      <button
        type="button"
        class="toggle loop-toggle"
        class:edit-only={!timeline.loop}
        aria-pressed={loopOn}
        disabled={!timeline.loop}
        onclick={switchLoop}
        title={timeline.loop
          ? `Loop ${formatDuration(timeline.loop.start)} to ${formatDuration(timeline.loop.end)}`
          : 'Drag along the top of the ruler to set a Loop'}>Loop</button
      >
      <button
        type="button"
        class="toggle record edit-only"
        aria-pressed={capturing}
        disabled={!capturing && !canRecord}
        onclick={switchRecording}
        title={capturing
          ? 'Stop recording (R or Space)'
          : syncing
            ? 'Leave Sync mode to record'
            : playerState !== 'stopped'
              ? 'Stop playback to record'
              : recordProblem
                ? recordProblem
                : `Record a Take on ${timeline.tracks.find((t) => t.id === chosen)?.name ?? 'a new Track'} (R)`}
        ><span class="record-dot" aria-hidden="true"></span>{capturing ? 'Stop' : 'Record'}</button
      >
      <span class="edit-only"
        ><InputSettings
          disabled={recording !== null}
          offset={calibration.offset}
          onCalibrate={() => (calibrating = { offer: false })}
        /></span
      >
      {#if calibration.offset === null && !recording}
        <button
          type="button"
          class="not-calibrated edit-only"
          disabled={!canRecord}
          title="Takes are placed by the latency the browser reports until it's calibrated. Calibrate it now, or any time in the recording settings."
          onclick={() => (calibrating = { offer: false })}>Not calibrated</button
        >
      {/if}
      {#if recording?.phase === 'starting'}
        <span class="muted" role="status">Opening the microphone…</span>
      {:else if recording?.phase === 'saving'}
        <span class="muted" role="status">Saving the Take…</span>
      {:else if recording && inputNote}
        <span class="input-note" role="status">{inputNote}</span>
      {:else if recording && skipped}
        <span class="muted" role="status">Calibrate the latency any time in the recording settings.</span>
      {:else if playerState === 'loading'}
        <span class="muted" role="status">Loading audio…</span>
      {/if}
      <span class="spacer"></span>
      {@render undoRedo()}
      <button
        type="button"
        class="icon collapse-toggle"
        onclick={() => (collapsed = !collapsed)}
        aria-expanded={!collapsed}
        aria-controls="timeline-tracks"
        aria-label={collapsed ? 'Show the Timeline' : 'Hide the Timeline'}
      >
        {collapsed ? '▴' : '▾'}
      </button>
    </div>

    <div
      class="tracks"
      id="timeline-tracks"
      hidden={collapsed}
      style:max-height="{tracksHeight}px"
      onscroll={() => trackDrag.aim()}
    >
      <div class="heads" class:gripped={editable.current} bind:offsetHeight={headsHeight}>
        <div class="ruler-gap">
          <button
            type="button"
            class="button add edit-only"
            onclick={() => (picking = true)}
            title="Add a Beat to {timeline.tracks.find((t) => t.id === chosen)?.name ?? 'the Chosen Track'}"
            >+ Beat</button
          >
          <button type="button" class="button add edit-only" aria-label="Add a Track" onclick={addTrack}>+ Track</button
          >
        </div>
        {#each timeline.tracks as track, i (track.id)}
          {@const trackLevels = levels[i]}
          <!-- Clicking it outside its controls chooses the Track, pointer only for now, like dragging Clips. -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <div
            class="head"
            class:chosen={track.id === chosen}
            class:dragged={trackDrag.current?.from === i}
            class:drop-above={trackGap === i}
            class:drop-below={trackGap === timeline.tracks.length && i === timeline.tracks.length - 1}
            role="group"
            aria-label="Track {track.name}"
            aria-current={track.id === chosen ? 'true' : undefined}
            onclick={(e) => headClick(e, track)}
            {@attach (el) => trackDrag.placeHead(el, i)}
          >
            {#if editable.current}
              <!-- Pointer only: ↑ and ↓ move it from the keyboard. Its room stays while recording, so the lanes don't shift. -->
              <span
                class="grip"
                aria-hidden="true"
                title={trackDrag.on ? 'Drag to move; Esc cancels' : undefined}
                {...trackDrag.on ? trackDrag.grip(i, dropTrack) : {}}>{trackDrag.on ? '⠿' : ''}</span
              >
            {/if}
            <div class="head-row">
              {#if editable.current && renaming === track.id}
                <input
                  class="name"
                  value={naming[track.id] ?? track.name}
                  aria-label="Name of Track {track.name}"
                  onkeydown={(e) => nameKey(track, e)}
                  onblur={(e) => endRename(track, e.currentTarget, true)}
                  {@attach focusField}
                />
              {:else}
                <button
                  type="button"
                  class="name"
                  aria-label="Choose {track.name}"
                  onclick={() => choose({ kind: 'choose', trackId: track.id })}
                  ondblclick={() => editable.current && (renaming = track.id)}>{naming[track.id] ?? track.name}</button
                >
              {/if}
              {#if editable.current}
                <span class="track-actions">
                  <button
                    type="button"
                    id="rename-track-{track.id}"
                    class="rename"
                    onclick={() => (renaming = track.id)}
                    aria-label="Rename {track.name}"
                    title="Rename"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 20h4L19 9l-4-4L4 16z" />
                      <path d="M13.5 6.5l4 4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onclick={() => shift(i, -1)}
                    disabled={i === 0}
                    aria-label="Move {track.name} up"
                    title="Move up">↑</button
                  >
                  <button
                    type="button"
                    onclick={() => shift(i, 1)}
                    disabled={i === timeline.tracks.length - 1}
                    aria-label="Move {track.name} down"
                    title="Move down">↓</button
                  >
                  <button
                    type="button"
                    onclick={() => removeTrack(track)}
                    disabled={lastTrack}
                    aria-label="Delete {track.name} and its Clips"
                    title={lastTrack
                      ? "A Song always has a Track, so its last one can't be deleted"
                      : 'Delete the Track and its Clips'}>×</button
                  >
                </span>
              {/if}
            </div>
            <div class="head-row">
              <button
                type="button"
                class="toggle mute"
                aria-pressed={trackLevels.muted}
                onclick={() => setLevels(track, { muted: !trackLevels.muted })}
                aria-label="Mute {track.name}"
                title="Mute">M</button
              >
              <button
                type="button"
                class="toggle solo"
                aria-pressed={trackLevels.soloed}
                onclick={() => setLevels(track, { soloed: !trackLevels.soloed })}
                aria-label="Solo {track.name}"
                title="Solo">S</button
              >
              <input
                class="volume"
                type="range"
                min={silence}
                max={maxVolume}
                step="0.5"
                value={trackLevels.volume}
                aria-label="Volume of {track.name}"
                aria-valuetext={formatVolume(trackLevels.volume)}
                title="{formatVolume(trackLevels.volume)} (double-click for 0 dB)"
                oninput={(e) => volumeInput(track, e)}
                onchange={(e) => volumeChange(track, e)}
                ondblclick={() => setLevels(track, { volume: 0 })}
              />
            </div>
          </div>
        {/each}
      </div>
      <div class="lanes-wrap" bind:this={lanesWrapElement}>
        <div
          class="lanes"
          bind:this={lanesElement}
          bind:clientWidth={width}
          bind:offsetHeight={lanesHeight}
          onscroll={scrolled}
        >
          <div class="content" style:width="{span * view.scale}px">
            <!-- Pointer only, like dragging Clips; the Loop is switched on and off with its button. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="loop-bar"
              class:editable={editable.current}
              title={editable.current ? 'Drag to set a Loop' : undefined}
              onpointerdown={loopDown}
              onpointermove={loopMove}
              onpointerup={loopUp}
              onpointercancel={loopCancel}
            >
              {#if loop}
                {@const at = spanStyle(loop.start, loop.end)}
                <div
                  class="loop"
                  class:on={loop.on}
                  style:left={at.left}
                  style:width={at.width}
                  title="Loop {formatDuration(loop.start)} to {formatDuration(loop.end)}"
                >
                  <span class="loop-edge start edit-only" data-edge="start" title="Drag to move the Loop's start"
                  ></span>
                  <button
                    type="button"
                    class="loop-clear edit-only"
                    onpointerdown={(e) => e.stopPropagation()}
                    onclick={clearLoop}
                    aria-label="Clear the Loop"
                    title="Clear the Loop">×</button
                  >
                  <span class="loop-edge end edit-only" data-edge="end" title="Drag to move the Loop's end"></span>
                </div>
              {/if}
            </div>
            <div
              class="ruler"
              role="slider"
              tabindex="0"
              aria-label="Position"
              aria-valuemin={0}
              aria-valuemax={Math.round(span)}
              aria-valuenow={Math.round(position)}
              aria-valuetext="{formatDuration(position)} of {formatDuration(length)}"
              onpointerdown={pointerDown}
              onpointermove={pointerMove}
              onpointerup={pointerUp}
              onpointercancel={pointerCancel}
              onkeydown={rulerKey}
            >
              {#each ticks as t (t)}
                <span class="tick" style:left="{percent(t)}%">{formatDuration(t)}</span>
              {/each}
            </div>
            {#each shown as { track, clips: placed }, t (track.id)}
              <div
                class="lane"
                class:dragged={trackDrag.current?.from === t}
                class:drop-above={trackGap === t}
                class:drop-below={trackGap === shown.length && t === shown.length - 1}
                bind:this={laneElements[t]}
              >
                {#each placed as { clip, at, editing } (clip.id)}
                  {@const wave = waveWindow(view, at.start, at.length)}
                  {@const title = sources.of(clip).title}
                  <!-- Focusable for its Delete and menu keys; pointer dragging has no key equivalent yet, and its actions are in its menu. -->
                  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
                  <div
                    class="clip"
                    class:editing
                    class:moving={editing && edit?.mode === 'move'}
                    class:nudging={editing && edit?.mode === 'nudge'}
                    class:retaking={clip.id === recording?.clipId}
                    style:left="{percent(at.start)}%"
                    style:width="{percent(at.length)}%"
                    {title}
                    role="group"
                    aria-label="{title}, {formatDuration(at.start)} to {formatDuration(at.start + at.length)}"
                    tabindex={editable.current ? 0 : undefined}
                    onpointerdown={(e) => editDown(e, clip, 'move')}
                    onkeydown={(e) => clipKey(e, clip)}
                    oncontextmenu={(e) => clipContextMenu(e, clip)}
                  >
                    <span class="clip-head">
                      <span class="clip-title">{title}</span>
                      <span class="clip-actions clip-menu edit-only">
                        <ActionsMenu
                          bind:this={clipMenus[clip.id]}
                          label="More actions for {title}"
                          entries={clipActions(clip)}
                        >
                          {#snippet trigger()}<span class="clip-more">⋯</span>{/snippet}
                        </ActionsMenu>
                      </span>
                    </span>
                    <span class="wave">
                      {#if wave}
                        <!-- Only around what's in view, a bar every barWidth pixels. -->
                        <svg
                          style:left="{wave.from * view.scale}px"
                          style:width="{wave.bars * barWidth}px"
                          viewBox="0 0 {wave.bars} 100"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          {#each clipShape(clip, at.offset + wave.from, wave.to - wave.from, (wave.bars * barWidth) / view.scale, wave.bars) as peak, i (i)}
                            {@const height = Math.max(2, peak * 100)}
                            <!-- A Take's clipping stays marked once it's saved; a Beat's isn't, being mastered loud. -->
                            <rect
                              class:clipped={clip.beatId === null && peak >= clipping}
                              x={i + 0.15}
                              y={(100 - height) / 2}
                              width="0.7"
                              {height}
                            />
                          {/each}
                        </svg>
                      {/if}
                    </span>
                    <span
                      class="trim start edit-only"
                      aria-hidden="true"
                      title="Drag to trim the start"
                      onpointerdown={(e) => editDown(e, clip, 'start')}
                    ></span>
                    <span
                      class="trim end edit-only"
                      aria-hidden="true"
                      title="Drag to trim the end"
                      onpointerdown={(e) => editDown(e, clip, 'end')}
                    ></span>
                  </div>
                {/each}
                {#if capturing && recording?.trackId === track.id && recording.plan && position > recording.plan.start}
                  {@const retaken = track.clips.find((c) => c.id === recording?.clipId)}
                  {@const taken = position - recording.plan.start}
                  {@const length = retaken ? Math.min(taken, retakeLength(retaken, track.clips, position)) : taken}
                  {@const shown = waveWindow(view, recording.plan.start, length)}
                  <!-- A Retake shows growing over its Clip, and stops at the next Clip, as it will be saved. -->
                  <div
                    class="clip taking"
                    style:left="{percent(recording.plan.start)}%"
                    style:width="{percent(length)}%"
                    aria-label="Recording from {formatDuration(recording.plan.start)}"
                  >
                    <span class="clip-head"><span class="clip-title">Recording…</span></span>
                    <span class="wave">
                      {#if shown}
                        <!-- In tiles, so only the last one changes as it grows, and only those in view. -->
                        {@const tileSeconds = (tileBars * barWidth) / view.scale}
                        {#each liveTiles as tile, k (k)}
                          {#if (k + 1) * tileSeconds > shown.from && k * tileSeconds < shown.to}
                            <svg
                              style:left="{k * tileBars * barWidth}px"
                              style:width="{tile.length * barWidth}px"
                              viewBox="0 0 {tile.length} 100"
                              preserveAspectRatio="none"
                              aria-hidden="true"
                            >
                              {#each tile as peak, i (i)}
                                {@const height = Math.max(2, peak * 100)}
                                <rect
                                  class:clipped={peak >= clipping}
                                  x={i + 0.15}
                                  y={(100 - height) / 2}
                                  width="0.7"
                                  {height}
                                />
                              {/each}
                            </svg>
                          {/if}
                        {/each}
                      {/if}
                    </span>
                  </div>
                {/if}
              </div>
            {/each}
            {#if loop?.on}
              {@const at = spanStyle(loop.start, loop.end)}
              <span class="loop-shade" style:left={at.left} style:width={at.width} aria-hidden="true"></span>
            {/if}
            <span class="playhead" style:left="{percent(position)}%" aria-hidden="true"></span>
          </div>
        </div>
        {#if thumb}
          <!-- Pointer only: the ruler is the keyboard's slider for the position. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="scrollbar" bind:this={barElement} onpointerdown={barDown} onwheel={barWheel} aria-hidden="true">
            <div
              class="scroll-thumb"
              class:dragging={thumbDrag !== null}
              style:left="{thumb.left}px"
              style:width="{thumb.width}px"
              onpointerdown={thumbDown}
              onpointermove={thumbMove}
              onpointerup={thumbUp}
              onpointercancel={thumbUp}
            ></div>
          </div>
        {/if}
      </div>
    </div>

    {#if offerCues}
      <div class="offer" role="status">
        <span>The Clip moved {formatCue(Math.abs(offerCues.by))} {offerCues.by > 0 ? 'later' : 'earlier'}.</span>
        <button type="button" class="button" onclick={moveCues}
          >Move {offerCues.count} {offerCues.count === 1 ? 'Cue' : 'Cues'} with it</button
        >
        <button type="button" class="button" onclick={() => (offerCues = null)}>Leave them</button>
      </div>
    {/if}
    {#if unsaved.length > 0}
      <div class="offer" role="status">
        <span>Recovered {unsaved.length} unsaved {unsaved.length === 1 ? 'Take' : 'Takes'}.</span>
        <button
          type="button"
          class="button"
          onclick={keepUnsaved}
          disabled={recovering || recording !== null}
          title="Upload {unsaved.length === 1 ? 'it' : 'them'} where {unsaved.length === 1
            ? 'it'
            : 'they'} would have gone, or after the last Clip on the Track if that spot's taken">Keep</button
        >
        <button type="button" class="button" onclick={discardUnsaved} disabled={recovering}>Discard</button>
      </div>
    {/if}
    {#if offerBpm}
      <div class="offer" role="status">
        <span>This Song has no BPM. Use {offerBpm.bpm} BPM from “{offerBpm.title}”?</span>
        <button type="button" class="button" onclick={useBpm}>Use {offerBpm.bpm} BPM</button>
        <button type="button" class="button" onclick={() => (offerBpm = null)}>No thanks</button>
      </div>
    {/if}
  </div>
  {#if error}
    <!-- Over the page just above the Timeline, so showing it never moves anything. -->
    <div class="error-bar" role="alert">
      <span class="error">{error}</span>
      <button type="button" class="dismiss" onclick={() => (error = null)} aria-label="Dismiss" title="Dismiss"
        >×</button
      >
    </div>
  {/if}
</section>

{#if calibrating}
  <CalibrationDialog
    offer={calibrating.offer}
    onCalibrated={storeCalibrated}
    onSkip={skipOffer}
    onClose={calibrationClosed}
  />
{/if}
{#if picking}
  <BeatPicker {song} onPick={addBeat} onClose={() => (picking = false)} />
{/if}

<style>
  .timeline {
    /*
     * How big the Timeline is next to the rest of the page, the one place to
     * change it: sizes are in --timeline-rem, which follows it. Hairline
     * borders stay 1px, and the side gutters stay level with the page's.
     */
    --timeline-scale: 1.25;
    --timeline-rem: calc(var(--timeline-scale) * 1rem);
    /* The page's control size, scaled, and never smaller than it. */
    --touch: max(var(--control), calc(var(--timeline-scale) * var(--control)));
    /* Docked at the bottom of the window, directly above the tab bar if there is one. */
    position: sticky;
    bottom: var(--nav-bottom-space);
    z-index: 1;
    border-top: 1px solid var(--border);
    background: var(--bg);
    font-size: var(--timeline-rem);
  }
  /* A few pixels either side of the top border, to be easy to grab. */
  .resize {
    position: absolute;
    top: calc(-0.3125 * var(--timeline-rem));
    right: 0;
    left: 0;
    z-index: 1;
    height: calc(0.5625 * var(--timeline-rem));
    cursor: row-resize;
    touch-action: none;
  }
  .resize:hover::after,
  .resize:focus-visible::after {
    content: '';
    position: absolute;
    top: calc(0.1875 * var(--timeline-rem));
    right: 0;
    left: 0;
    height: calc(0.1875 * var(--timeline-rem));
    background: var(--accent);
  }
  .resize:focus-visible {
    outline: none;
  }
  /* The full width of the window, for as much of the lanes as fits. */
  .inner {
    padding: calc(0.5 * var(--timeline-rem)) max(var(--gutter), env(safe-area-inset-right))
      max(calc(0.5 * var(--timeline-rem)), env(safe-area-inset-bottom)) max(var(--gutter), env(safe-area-inset-left));
  }
  /* The tab bar below keeps clear of the home indicator itself. */
  @media (width < 65.5rem) {
    .inner {
      padding-bottom: calc(0.5 * var(--timeline-rem));
    }
  }
  /* The page's buttons, sized for the Timeline. */
  .button {
    min-height: var(--touch);
    padding: 0 var(--timeline-rem);
    border-radius: calc(0.5 * var(--timeline-rem));
  }
  .icon {
    width: var(--touch);
    height: var(--touch);
    border-radius: calc(0.5 * var(--timeline-rem));
    font-size: calc(1.125 * var(--timeline-rem));
  }
  .transport,
  .offer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: calc(0.5 * var(--timeline-rem)) calc(0.75 * var(--timeline-rem));
  }
  .history {
    display: flex;
  }
  .history button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .spacer {
    flex: 1;
  }
  .play {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: var(--touch);
    height: var(--touch);
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
    cursor: pointer;
  }
  .play svg {
    width: calc(1.25 * var(--timeline-rem));
    height: calc(1.25 * var(--timeline-rem));
    fill: currentColor;
  }
  .time {
    font-size: calc(0.8125 * var(--timeline-rem));
    font-variant-numeric: tabular-nums;
  }
  .tracks {
    /* Shared by the headers and the lanes, so they stay level. */
    --track-height: calc(3.5 * var(--timeline-rem));
    display: flex;
    /* Stretched to the height cap, the headers would squash and the lanes be cut off. */
    align-items: flex-start;
    margin-top: calc(0.5 * var(--timeline-rem));
    overflow-y: auto;
  }
  .tracks[hidden] {
    display: none;
  }
  .heads {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    width: calc(11 * var(--timeline-rem));
    padding-right: calc(0.5 * var(--timeline-rem));
  }
  .ruler-gap,
  .ruler {
    height: calc(1.5 * var(--timeline-rem));
    flex-shrink: 0;
  }
  /* Beside the loop bar and the ruler, and where a Beat or a Track is added, like a DAW's. */
  .ruler-gap {
    display: flex;
    align-items: center;
    gap: calc(0.375 * var(--timeline-rem));
    height: calc(2.25 * var(--timeline-rem));
  }
  /* Small enough for the corner, both side by side; the corner can't grow without moving the lanes. */
  .add {
    min-height: calc(1.75 * var(--timeline-rem));
    padding: 0 calc(0.625 * var(--timeline-rem));
    font-size: calc(0.875 * var(--timeline-rem));
  }
  .head {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex-shrink: 0;
    gap: calc(0.25 * var(--timeline-rem));
    height: var(--track-height);
    padding-left: calc(0.375 * var(--timeline-rem));
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    /* Clicking it chooses the Track; its rename field is still selectable. */
    user-select: none;
  }
  /* The grip's strip along each header's left edge widens the column, not squeezing the controls. */
  .heads.gripped {
    width: calc(12.25 * var(--timeline-rem));
  }
  .heads.gripped .head {
    position: relative;
    padding-left: calc(1.625 * var(--timeline-rem));
  }
  .grip {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    display: grid;
    /* At the top, level with the Track's name. */
    place-content: start;
    padding: calc(0.5 * var(--timeline-rem)) 0 0 calc(0.25 * var(--timeline-rem));
    width: calc(1.25 * var(--timeline-rem));
    color: var(--text-muted);
    font-size: calc(0.875 * var(--timeline-rem));
    cursor: grab;
    touch-action: none;
  }
  .grip:empty {
    cursor: default;
  }
  .grip:hover {
    color: var(--text);
  }
  .head.dragged,
  .lane.dragged {
    opacity: 0.5;
  }
  .head.dragged .grip {
    cursor: grabbing;
  }
  /* The drop shows in the gap the dragged Track would land in, across its header and lane. */
  .head.drop-above::before,
  .head.drop-below::after,
  .lane.drop-above::before,
  .lane.drop-below::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    z-index: 2;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
    pointer-events: none;
  }
  .head.drop-above::before,
  .lane.drop-above::before {
    top: -2px;
  }
  .head.drop-below::after,
  .lane.drop-below::after {
    bottom: -2px;
  }
  /* Marked along its left edge, in the room left for it. */
  .head.chosen {
    box-shadow: inset calc(0.1875 * var(--timeline-rem)) 0 0 var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .head-row {
    display: flex;
    align-items: center;
    gap: calc(0.25 * var(--timeline-rem));
    min-width: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 0 calc(0.125 * var(--timeline-rem));
    border: 1px solid transparent;
    border-radius: calc(0.25 * var(--timeline-rem));
    background: none;
    color: var(--text);
    font: inherit;
    font-size: calc(0.8125 * var(--timeline-rem));
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button.name {
    text-align: left;
    cursor: pointer;
  }
  button.name:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  input.name {
    border-color: var(--border);
  }
  .track-actions {
    display: flex;
    flex-shrink: 0;
  }
  .track-actions button {
    padding: 0 calc(0.25 * var(--timeline-rem));
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: calc(0.75 * var(--timeline-rem));
    cursor: pointer;
  }
  .track-actions button:hover:not(:disabled),
  .track-actions button:focus-visible {
    color: var(--accent);
  }
  /* As big as the arrows and cross beside it. */
  .rename svg {
    width: calc(0.625 * var(--timeline-rem));
    height: calc(0.625 * var(--timeline-rem));
    vertical-align: -0.0625em;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .track-actions button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .toggle {
    flex-shrink: 0;
    width: calc(1.5 * var(--timeline-rem));
    height: calc(1.25 * var(--timeline-rem));
    padding: 0;
    border: 1px solid var(--border);
    border-radius: calc(0.25 * var(--timeline-rem));
    background: none;
    color: var(--text-muted);
    font-size: calc(0.6875 * var(--timeline-rem));
    font-weight: 700;
    cursor: pointer;
  }
  .toggle[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
  }
  .volume {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 0;
    accent-color: var(--accent);
    /* The browser draws the slider at its own size, so it's zoomed instead. */
    zoom: var(--timeline-scale);
  }
  /* The lanes, and the scroll bar over their bottom edge. */
  .lanes-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .lanes {
    overflow-x: auto;
    overflow-y: hidden;
    /* .scrollbar stands in for the browser's, which took height. */
    scrollbar-width: none;
    /* Pinching zooms the Timeline, not the page. */
    touch-action: pan-x pan-y;
  }
  .lanes::-webkit-scrollbar {
    display: none;
  }
  /* Kept at the bottom of the Tracks area's view as it scrolls, taking no height. */
  .scrollbar {
    --scrollbar-height: calc(0.75 * var(--timeline-rem));
    position: sticky;
    bottom: 0;
    z-index: 2;
    height: var(--scrollbar-height);
    margin-top: calc(-1 * var(--scrollbar-height));
    cursor: pointer;
    touch-action: none;
  }
  /* Thin at rest, thicker to grab. Edged in the background colour, to show over Clips. */
  .scroll-thumb {
    position: absolute;
    top: calc(0.25 * var(--timeline-rem));
    bottom: calc(0.125 * var(--timeline-rem));
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-muted) 60%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg) 60%, transparent);
    cursor: grab;
    transition:
      top 0.1s,
      bottom 0.1s;
  }
  .scroll-thumb.dragging {
    top: calc(0.0625 * var(--timeline-rem));
    bottom: calc(0.0625 * var(--timeline-rem));
    background: var(--text-muted);
  }
  .scrollbar:hover .scroll-thumb {
    top: calc(0.0625 * var(--timeline-rem));
    bottom: calc(0.0625 * var(--timeline-rem));
    background: var(--text-muted);
  }
  .scroll-thumb.dragging {
    cursor: grabbing;
  }
  .content {
    position: relative;
  }
  .loop-bar {
    position: relative;
    height: calc(0.75 * var(--timeline-rem));
    overflow: hidden;
    background: var(--surface-1);
    touch-action: none;
    /* Dragging along it sets a Loop, never selecting what it passes. */
    user-select: none;
  }
  .loop-bar.editable {
    cursor: crosshair;
  }
  .loop {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    justify-content: center;
    border-radius: calc(0.125 * var(--timeline-rem));
    background: var(--border);
  }
  .loop.on {
    background: var(--accent);
    color: var(--accent-text);
  }
  .loop-edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: calc(0.375 * var(--timeline-rem));
    cursor: ew-resize;
  }
  .loop-edge.start {
    left: 0;
  }
  .loop-edge.end {
    right: 0;
  }
  .loop-edge:hover {
    background: var(--text);
    opacity: 0.4;
  }
  .loop-clear {
    display: none;
    padding: 0 calc(0.25 * var(--timeline-rem));
    border: none;
    background: none;
    color: inherit;
    font-size: calc(0.75 * var(--timeline-rem));
    line-height: calc(0.75 * var(--timeline-rem));
    cursor: pointer;
  }
  .loop:hover .loop-clear,
  .loop-clear:focus-visible {
    display: block;
  }
  .loop-shade {
    position: absolute;
    top: calc(0.75 * var(--timeline-rem));
    bottom: 0;
    background: var(--accent);
    opacity: 0.08;
    pointer-events: none;
  }
  .toggle.loop-toggle {
    width: auto;
    padding: 0 calc(0.375 * var(--timeline-rem));
  }
  .toggle.loop-toggle:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .toggle.record {
    display: inline-flex;
    align-items: center;
    gap: calc(0.3125 * var(--timeline-rem));
    width: auto;
    padding: 0 calc(0.375 * var(--timeline-rem));
  }
  .record-dot {
    width: calc(0.5 * var(--timeline-rem));
    height: calc(0.5 * var(--timeline-rem));
    border-radius: 50%;
    background: var(--danger);
  }
  .toggle.record[aria-pressed='true'] {
    border-color: var(--danger);
    background: var(--danger);
    color: var(--bg);
  }
  /* Stop is a square. */
  .toggle.record[aria-pressed='true'] .record-dot {
    border-radius: 1px;
    background: currentColor;
  }
  .not-calibrated {
    padding: 0.125rem 0.375rem;
    border: 1px dashed var(--warning);
    border-radius: 0.25rem;
    background: none;
    color: var(--warning);
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .not-calibrated:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .input-note {
    color: var(--warning);
  }
  .toggle.record:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ruler {
    position: relative;
    /* A label near the end would stick out past the lanes, giving them a
       horizontal scrollbar that pushes the Tracks area into scrolling, whose
       scrollbar narrows the lanes and moves the ticks: an endless flicker. */
    overflow: hidden;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    touch-action: none;
    /* Clicking or dragging along it seeks, never selecting its labels. */
    user-select: none;
  }
  .ruler:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .tick {
    position: absolute;
    top: 0;
    padding-left: calc(0.25 * var(--timeline-rem));
    border-left: 1px solid var(--border);
    color: var(--text-muted);
    font-size: calc(0.75 * var(--timeline-rem));
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .lane {
    position: relative;
    height: var(--track-height);
    border-bottom: 1px solid var(--border);
  }
  .clip {
    position: absolute;
    top: calc(0.25 * var(--timeline-rem));
    bottom: calc(0.25 * var(--timeline-rem));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--accent);
    border-radius: calc(0.25 * var(--timeline-rem));
    background: var(--surface-1);
    /* A long press opens the Clip's menu, not the browser's text selection or callout. */
    user-select: none;
    -webkit-touch-callout: none;
  }
  @media (min-width: 40.0625rem) {
    .clip {
      cursor: grab;
    }
  }
  .clip:focus-visible,
  .clip.editing {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .clip.editing {
    z-index: 1;
  }
  .clip.moving {
    cursor: grabbing;
    opacity: 0.85;
  }
  .clip.nudging {
    cursor: ew-resize;
  }
  /* The Take being recorded, growing as it goes. */
  /* The Clip being retaken, silent and left be until the Retake is saved. */
  .clip.retaking {
    opacity: 0.5;
    pointer-events: none;
  }
  .clip.taking {
    border-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 15%, var(--surface-1));
    cursor: default;
  }
  .clip-head {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .clip-title {
    flex: 1;
    min-width: 0;
    padding: 0 calc(0.25 * var(--timeline-rem));
    font-size: calc(0.6875 * var(--timeline-rem));
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .clip-actions {
    display: none;
    flex-shrink: 0;
  }
  /* And while its menu is open, which, with focus moving into it, would otherwise hide with it. */
  .clip:hover .clip-actions,
  .clip:focus-within .clip-actions,
  .clip-actions:has(:global([aria-expanded='true'])) {
    display: flex;
  }
  .clip-more {
    display: block;
    padding: 0 calc(0.25 * var(--timeline-rem));
    font-size: calc(0.75 * var(--timeline-rem));
    line-height: 1.25;
  }
  .clip-more:hover,
  :global(:focus-visible) > .clip-more {
    color: var(--accent);
  }
  .trim {
    position: absolute;
    top: 0;
    bottom: 0;
    width: calc(0.375 * var(--timeline-rem));
    cursor: ew-resize;
  }
  .trim.start {
    left: 0;
  }
  .trim.end {
    right: 0;
  }
  .trim:hover {
    background: var(--accent);
    opacity: 0.4;
  }
  .wave {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .wave svg {
    position: absolute;
    top: 0;
    height: 100%;
  }
  rect {
    fill: var(--accent);
    opacity: 0.7;
  }
  /* A peak of a Take that clipped. */
  rect.clipped {
    fill: var(--danger);
    opacity: 1;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    /* In whole pixels, so it stays sharp. */
    width: round(calc(0.125 * var(--timeline-rem)), 1px);
    margin-left: round(calc(-0.0625 * var(--timeline-rem)), 1px);
    background: var(--text);
    pointer-events: none;
  }
  .offer {
    margin-top: calc(0.5 * var(--timeline-rem));
    font-size: calc(0.875 * var(--timeline-rem));
  }
  .error-bar {
    position: absolute;
    bottom: calc(100% + 0.5 * var(--timeline-rem));
    left: max(var(--gutter), env(safe-area-inset-left));
    right: max(var(--gutter), env(safe-area-inset-right));
    display: flex;
    align-items: center;
    gap: calc(0.5 * var(--timeline-rem));
    padding: calc(0.375 * var(--timeline-rem)) calc(0.75 * var(--timeline-rem));
    border: 1px solid var(--danger);
    border-radius: calc(0.5 * var(--timeline-rem));
    background: var(--bg);
    box-shadow: 0 calc(0.25 * var(--timeline-rem)) var(--timeline-rem) rgb(0 0 0 / 0.2);
  }
  .error-bar .error {
    flex: 1;
    min-width: 0;
  }
  .dismiss {
    flex-shrink: 0;
    padding: 0 calc(0.25 * var(--timeline-rem));
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: calc(1.125 * var(--timeline-rem));
    cursor: pointer;
  }

  /*
   * On a phone, the Timeline only plays: the transport row alone. The Tracks
   * are hidden much as when collapsed, so they come back as they were on
   * widening the window, and playback goes on with their saved levels and Loop.
   */
  @media (max-width: 40rem) {
    /* Already sized for a phone, and there's no room to spare. */
    .timeline {
      --timeline-scale: 1;
    }
    .edit-only,
    .resize,
    .tracks {
      display: none;
    }
    /* The Tracks can't open here, so the collapse toggle has nothing to do. */
    .collapse-toggle {
      display: none;
    }
    /* Easier to hit with a thumb. */
    .toggle.loop-toggle {
      height: calc(1.5 * var(--timeline-rem));
    }
  }
</style>
