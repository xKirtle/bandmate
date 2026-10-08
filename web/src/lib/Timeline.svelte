<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import Circle from '@lucide/svelte/icons/circle';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Pause from '@lucide/svelte/icons/pause';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Play from '@lucide/svelte/icons/play';
  import Plus from '@lucide/svelte/icons/plus';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import SkipBack from '@lucide/svelte/icons/skip-back';
  import SkipForward from '@lucide/svelte/icons/skip-forward';
  import Square from '@lucide/svelte/icons/square';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import X from '@lucide/svelte/icons/x';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { innerHeight } from 'svelte/reactivity/window';
  import { api, type Beat, type Clip, type Song, type Timeline, type Track, type TrackChanges } from './api';
  import ActionsMenu from './ActionsMenu.svelte';
  import BeatPicker from './BeatPicker.svelte';
  import { inputProblem } from './capture';
  import { chosenTrack, readChosen, storeChosen, type ChoiceEvent } from './chosenTrack';
  import { ClipDrag, type ClipGrip, type ClipMeasure, type DragAt } from './clipDrag.svelte';
  import { LoopDrag, type LoopAt } from './loopDrag.svelte';
  import { guideLanes, reachAt } from './snapping';
  import { clipSources, clipTitle, fileStart, playing } from './clipSource';
  import { formatCue } from './cues';
  import type { Saves } from './saves.svelte';
  import type { SyncMode } from './syncMode.svelte';
  import { editHint, type Freeze } from './freeze';
  import { draggedFiles, fileDropTrack, type TrackRow } from './fileDrop';
  import { keyHints } from './keyHints';
  import { formatVolume, maxVolume, minVolume, trackGains } from './mixer';
  import type { MenuAction } from './menu';
  import { peaksPerSecond } from './peaks';
  import { keyActedOnPage } from './pointerFocus';
  import { laneStep, pressLane, type LaneInput, type LanePress } from './lanePress';
  import { longPressDelay, type Point } from './press';
  import { retakeLength } from './recording';
  import { timelineEnd, type Loop, type Placed } from './schedule';
  import { nameSound } from './soundName';
  import { inTextField } from './textField';
  import { keyPlace } from './keyPlace';
  import { songKey } from './songKeys';
  import { allKeys, shortcuts, type Way } from './shortcuts';
  import { clipActions, selectionActions } from './clipMenu';
  import { mergeTarget, mergedClips, renderMerge } from './merge';
  import { rightHalfOf, splitTargets } from './split';
  import { Selection, type ClipIds, type SelectionBox } from './selection.svelte';
  import { TimelineEditing } from './timelineEditing.svelte';
  import { committedAsItGoes, type TypedField } from './typedField.svelte';
  import {
    copy,
    duplicate as duplicatePlacement,
    emptyClipboard,
    paste,
    type Clipboard,
    type Paste,
  } from './clipboard';
  import {
    addsBox,
    isModifier,
    nudges,
    rulerSeek,
    skipsSnapping,
    startOrEnd,
    timelineKey,
    togglesSelection,
    zooms,
  } from './timelineKeys';
  import { prepareUpload } from './upload';
  import { formatDuration } from './time';
  import { tracksDropped, type TrackDrop } from './trackDrag';
  import { transportActions } from './transportMenu';
  import { TrackDragging } from './trackDragging.svelte';
  import InputSettings from './InputSettings.svelte';
  import CalibrationDialog from './CalibrationDialog.svelte';
  import MixdownDialog from './MixdownDialog.svelte';
  import { mixdownEnd } from './mixdown';
  import { appliedOffset } from './calibration';
  import { deviceStorage } from './deviceStorage';
  import { calibration } from './sharedCalibration.svelte';
  import { input as chosenInput } from './sharedInput.svelte';
  import { clampHeight, defaultHeight, grownHeight, heightBounds, readHeight, storeHeight } from './timelineHeight';
  import { fullScreenQuery } from './timelineLayout';
  import { audioContext, TimelinePlayer, type PlayableClip } from './timelinePlayer';
  import { Transport } from './transport.svelte';
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
  import { barWidth, bars } from './waveform';
  import { clipping, tileBars } from './liveWave';
  import { browserKeeping, capturedInput, TakeRecorder } from './takeRecorder.svelte';
  import { clampGain, formatGain, gainLineAt, heardPeak } from './clipGain';
  import { fadeName, fitFades, formatFade, isFadeEnd, shapedPeak, type FadeEnd } from './clipFade';

  // The Timeline, docked under the Lyric Sheet: its Tracks and Clips, and
  // playback with each Track's volume, mute and solo, and the Loop. Editing
  // (adding Beats and Sounds, adding, renaming, reordering and deleting
  // Tracks, moving, trimming, renaming, duplicating and deleting Clips,
  // setting and clearing the Loop, and undoing and redoing all of it along
  // with mixing and Cue edits) is only offered on wider screens; on a phone
  // it only plays, mixes and switches the Loop on and off. On both it zooms
  // and scrolls, and follows the playhead while playing. While the Loop is
  // on, playback that reaches its end goes back to its start. Recording a
  // Take onto the chosen Track is offered where editing is, and mixing it
  // down to a file on both.
  let {
    song,
    saves,
    setBpm,
    onPlayhead,
    syncMode,
    onRecording,
    height = $bindable(0),
  }: {
    song: Song;
    /** The Song's saves, which the Timeline's edits and Cue changes go through. */
    saves: Saves;
    /** Sets the Song's BPM. */
    setBpm: (bpm: number) => void;
    /** Hears where playback is, in seconds, every frame while playing, then null once it stops. */
    onPlayhead?: (at: number | null) => void;
    /**
     * Sync mode, which recording can't start in. The Timeline attaches its
     * Loop, recording, Clips and playhead to it while it's mounted.
     */
    syncMode: SyncMode;
    /** Hears whether a recording is on, whenever that changes, e.g. to keep the Song from being deleted meanwhile. */
    onRecording?: (on: boolean) => void;
    /** How tall the docked Timeline is, in pixels, e.g. for the page to keep clear of it. */
    height?: number;
  } = $props();

  let error = $state<string | null>(null);
  let collapsed = $state(false);
  let picking = $state(false);
  // A Beat just added whose BPM could become the Song's.
  let offerBpm = $state<{ bpm: number; title: string } | null>(null);

  // Playing, pausing, seeking and stopping at the end go through Transport
  // (see transport.svelte.ts), on the Timeline's player, which the
  // Timeline also loads audio and sets each Track's gain through. The ruler
  // scrub and following the playhead go through Transport too: the Timeline
  // turns the pointer into seconds, scrolls the lanes at their edges, and
  // scrolls the playhead into view while Transport says it's followed.
  let player!: TimelinePlayer;
  const transport: Transport = new Transport({
    player: (onState) => (player = new TimelinePlayer(onState)),
    playable: () => playable,
    loop: () => playingLoop,
    length: () => length,
    recording: () => recording,
    capturing: () => capturing,
    onCaptureStopped: () => stopRecording(),
    onError: (message) => showError(message),
    onFollow: (at) => {
      // Not while a Clip or the Loop is dragged, which would jump with the page.
      if (!clipDrag.clip && !loopDrag.pressed) reveal(at);
    },
  });
  const playerState = $derived(transport.state);
  const position = $derived(transport.position);

  // Recording a Take onto the chosen Track, or a Retake into a Clip of
  // Takes, and offering back Takes that never reached the server: see
  // takeRecorder.svelte.ts. Transport plays along with it: everything
  // playing as mixed but ignoring the Loop, the Clip retaken left silent.
  // The Timeline decides when Record is offered, and draws the recording.
  // Only offered while stopped, and never along with Sync mode.
  const recorder: TakeRecorder = new TakeRecorder({
    saves: untrack(() => saves),
    player: transport,
    input: capturedInput(
      audioContext,
      () => $state.snapshot(chosenInput.value),
      (reported) => appliedOffset(calibration.value, reported),
    ),
    keeping: browserKeeping,
    uploads: api,
    onTrackAdded: (trackId) => choose({ kind: 'add', trackId }),
    onError: (message) => showError(message),
  });
  const liveTiles = $derived.by(() => recorder.liveTiles(barWidth / view.scale));
  // Whether a recording is on, from pressing Record until its Take is saved.
  const recording = $derived(recorder.phase !== null);
  // Whether a recording is capturing, rather than starting or saving.
  const capturing = $derived(recorder.capturing);

  // The Selection: the Clips the next Clip action applies to. Like choosing
  // a Track, selecting isn't an edit, and it's never kept, so leaving the
  // Song drops it. A phone, where Clips can't be edited, has none.
  const selection: Selection = new Selection(
    () => timeline.tracks,
    (): Freeze => editing.freeze,
  );

  // Every edit made here goes through Timeline editing, on top of Saves,
  // which keeps them to undo: see timelineEditing.svelte.ts. It selects
  // what an edit adds, chooses a Track added, offers to move the Cues of
  // Clips moved, and makes Merges and Sound imports, with the audio the
  // browser decodes and renders. The Timeline keeps the playhead.
  const editing: TimelineEditing = new TimelineEditing({
    saves: untrack(() => saves),
    selection,
    recording: () => recording,
    choose: (trackId) => choose({ kind: 'add', trackId }),
    audio: {
      prepare: async (file) => {
        const [decoded, name] = await Promise.all([prepareUpload(file, maxUploadBytes), nameSound(file)]);
        return { ...decoded, name };
      },
      // Loading each source as the player does, which keeps it for playback.
      renderMerge: (before, target) =>
        renderMerge(mergedClips(before, sources, target.clipIds), target, (s) => player.load(s)),
    },
  });
  onDestroy(() => editing.close());
  // The Timeline as shown, which it draws and plays: as saved, with the
  // values of edits on their way and of previews on top, e.g. a fader's
  // level while it's dragged, or a name until it's saved.
  const timeline = $derived(editing.timeline);

  // While recording, a new Take or a Retake, from its start until it's
  // saved, the Timeline is frozen: nothing on it is edited but a Track's
  // levels, the playhead stays with the recording, and the Selection is
  // locked, gestures leaving it as it was (see freeze.ts). Likewise while a
  // Merge is made, from pressing Merge until its Sound is saved, though
  // playback carries on as usual.
  const freeze = $derived(editing.freeze);
  const frozen = $derived(editing.frozen);

  // Why the unsaved Takes offered can't be kept or discarded meanwhile.
  const unsavedFrozenHint = $derived(
    freeze === 'merging'
      ? 'Wait for the Merge to finish to keep or discard them'
      : 'Stop recording to keep or discard them',
  );

  // Peaks by source key, fetched once each, so waveforms show before the
  // audio is decoded.
  let peaks = $state<Record<string, number[]>>({});

  onDestroy(() => {
    recorder.close();
    player.dispose();
  });

  const sources = $derived(clipSources(timeline));
  const clips = $derived(timeline.tracks.flatMap((t) => t.clips));
  // Each Clip plays the part of its audio file that it holds: a Take's only
  // where it has audio in the Clip. Not the Clip being retaken.
  const playable = $derived<PlayableClip[]>(playing(timeline, sources, recorder.clipId));
  // With Cues but no Clips, it still plays, in silence, for the Lyric Sheet
  // to follow.
  const length = $derived(timelineEnd(clips, song));
  // It shows in full even with nothing on it, and grows while recording.
  const span = $derived(
    shownSpan({ end: length, loopEnd: timeline.loop?.end, recordingAt: capturing ? position : undefined }),
  );
  const loopOn = $derived(timeline.loop?.on ?? false);
  // The Loop playback repeats, while it's on.
  const playingLoop = $derived<Loop | null>(loopOn ? { start: timeline.loop!.start, end: timeline.loop!.end } : null);
  // Matches the upright phone's layout below, which hides editing.
  const editable = new MediaQuery(`(min-width: 40.0625rem), ${fullScreenQuery}`);
  // A phone held sideways: the Timeline fills the window and can't be
  // collapsed, its Tracks taking all the height below the transport row.
  const fullScreen = new MediaQuery(fullScreenQuery);
  // Collapsing is only set aside there, so it's back on turning upright or
  // widening the window.
  const tracksShown = $derived(!collapsed || fullScreen.current);
  const resizable = $derived(!collapsed && !fullScreen.current);

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

  async function undo() {
    // Undoing a new Take returns the playhead to where its Clip starts, to
    // record again from. Once the Clip's gone, it's a seek like any other:
    // playing, playback jumps there, superseding the restart the Clip's
    // going started.
    const at = await editing.undo();
    if (at !== null) seekTo(at);
  }

  async function redo() {
    await editing.redo();
  }

  // Tooltips name a Shortcut's keys as this platform does, e.g. ⌘Z on a
  // Mac, but only with a keyboard and mouse.
  const hints = keyHints();
  // What a focused Clip and the ruler declare as their keys.
  const clipKeys = [...shortcuts.deleteClip.keys, ...shortcuts.clipMenu.keys];
  const rulerKeys = allKeys([shortcuts.seek, shortcuts.seekFar, shortcuts.startOrEnd]);

  function keydown(event: KeyboardEvent) {
    if (trackDrag.current && event.key === 'Escape') {
      event.preventDefault();
      trackDrag.cancel();
      return;
    }
    const shortcut = songKey(event, {
      busy: picking || calibrating !== null || mixingDown,
      ...keyPlace(event),
      ownsSpace: ownsSpace(event.target),
      ownsHomeEnd: ownsHomeEnd(event.target),
      editable: editable.current,
      recording,
      capturing,
      canRecord,
    });
    if (!shortcut) return;
    // Otherwise Space would scroll the page, for one.
    event.preventDefault();
    if (shortcut === 'playPause') {
      keyActedOnPage();
      transport.toggle();
    } else if (shortcut === 'start' || shortcut === 'end') {
      // It seeks, rather than acting on what a click focused, e.g. a lane's Clip.
      keyActedOnPage();
      seekTo(startOrEnd(shortcut === 'start' ? 'back' : 'forward', length));
    } else if (shortcut === 'record') switchRecording();
    else if (shortcut === 'split') splitAtPlayhead();
    else if (shortcut === 'undo') undo();
    else redo();
  }

  // Changes to a Track's levels are shown and heard right away, before
  // they're saved, and a fader's level while it's dragged, so it follows
  // the hand: see the Timeline as shown.
  $effect(() => player.setGains(trackGains(timeline.tracks)));

  function setLevels(track: Track, changes: Omit<TrackChanges, 'name'>) {
    // If it fails, the Track goes back to how it's saved.
    editing.edit({ kind: 'updateTrack', trackId: track.id, changes });
  }

  // A fader's volume is sent once it's let go (see TimelineEditing.letGoFader).
  // The browser says so with a change, but not for one let go where it
  // started, which only the pointer's release tells, so either lets go of it.
  /** Stops waiting for the fader pressed to be let go, if one is. */
  let ungrab = () => {};

  function grabFader(trackId: number, fader: HTMLInputElement) {
    ungrab();
    // It may be let go anywhere on the page, or the pointer lost.
    const release = () => {
      ungrab();
      editing.letGoFader(trackId, Number(fader.value));
    };
    ungrab = () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      ungrab = () => {};
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }
  onDestroy(() => ungrab());

  // A Track's name shows as a button that chooses it; its pencil swaps it
  // for a field to rename it in (see TimelineEditing.trackName): a blank
  // name goes back to the one saved. Until a new name is saved, it's shown.
  let renaming = $state.raw<{ trackId: number; name: TypedField<string> } | null>(null);

  function focusField(input: HTMLInputElement) {
    input.focus();
    input.select();
  }

  function startRename(track: Track) {
    if (renaming?.trackId === track.id) return;
    renaming = { trackId: track.id, name: editing.trackName(track.id) };
  }

  /** Stops renaming a Track, saving the name typed unless asked not to. */
  function endRename(track: Track, save: boolean) {
    if (renaming?.trackId !== track.id) return;
    if (save) renaming.name.commit();
    else renaming.name.cancel();
    renaming = null;
  }

  function nameKey(track: Track, event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    endRename(track, event.key === 'Enter');
    // Back to the pencil, where renaming started.
    tick().then(() => document.getElementById(`rename-track-${track.id}`)?.focus());
  }

  /** Moves a Track up or down by one, with its Clips. */
  function shift(index: number, by: -1 | 1) {
    const order = timeline.tracks.map((t) => t.id);
    [order[index], order[index + by]] = [order[index + by], order[index]];
    editing.edit({ kind: 'reorderTracks', order });
  }

  // Dragging a Track by its grip, on desktop and not while frozen. A drop
  // saves what as many presses of ↑ or ↓ would, as one edit.
  const trackIds = $derived(timeline.tracks.map((t) => t.id));
  const trackDrag = new TrackDragging(
    () => editable.current && !frozen,
    () => trackIds.join(),
  );
  // The gap between Tracks the dragged one would drop into, if it moves at all.
  const trackGap = $derived(trackDrag.current?.drop?.gap ?? null);

  function dropTrack(drop: TrackDrop) {
    editing.edit({ kind: 'reorderTracks', order: tracksDropped(trackIds, drop) });
  }

  // Deleting a Track doesn't ask first either: it can be undone. A Song
  // always has a Track, so its last one can't go.
  const lastTrack = $derived(timeline.tracks.length === 1);

  function removeTrack(track: Track) {
    if (lastTrack) return;
    editing.edit({ kind: 'deleteTrack', trackId: track.id });
  }

  // Tells the Song page where playback is, e.g. for the Lyric Sheet to
  // follow: every frame while playing, and kept at the end once reached,
  // so the last Line stays highlighted, until it's moved.
  $effect(() => onPlayhead?.(transport.playingAt));

  /**
   * A time on the Timeline shown, kept on its ruler: past the end too, e.g.
   * to record there, though playback still stops at the end.
   */
  function clamp(t: number): number {
    return Math.max(0, Math.min(span, t));
  }

  // Clicking on the ruler seeks, and dragging along it scrubs the playhead:
  // see Transport.
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
        if (!transport.scrubbing) transport.stopFollowing();
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
    // Clicking the playhead back into view follows it again, even while
    // recording, which doesn't scrub.
    transport.startScrub(timeAt(event));
    if (transport.scrubbing) (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function pointerMove(event: Point) {
    if (!transport.scrubbing) return;
    transport.scrubTo(timeAt(event));
    dragAt(event, pointerMove);
  }

  function pointerUp(event: PointerEvent) {
    if (!transport.scrubbing) return;
    dragDone();
    transport.endScrub(timeAt(event));
  }

  // A drag given up, e.g. for a pinch, isn't a seek.
  function pointerCancel() {
    if (!transport.scrubbing) return;
    transport.cancelScrub();
    dragDone();
  }

  function rulerKey(event: KeyboardEvent) {
    const to = rulerSeek(event, position);
    if (to === null) return;
    event.preventDefault();
    // It seeks, rather than acting on the ruler a click focused.
    keyActedOnPage();
    seekTo(to);
  }

  /** Seeks as asked by hand, bringing the playhead into view. */
  function seekTo(to: number) {
    transport.seek(clamp(to));
    reveal(position);
  }

  /**
   * Plays from a time asked by hand, e.g. leading into a Cue: starts playback
   * there, or jumps there if it's playing already, never pausing it.
   */
  export function playFrom(at: number) {
    // Nor while a recording starts or saves, stopped meanwhile.
    if (recording) return;
    transport.playFrom(clamp(at));
    reveal(position);
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
    return inMenuOrDialog(target);
  }

  /**
   * Whether Home and End pressed there are its own: in a text field, a
   * list (a select) or a slider, e.g. a Track's volume, or a ⋯ menu. The ruler isn't
   * one: there they go to the start and the end as anywhere else.
   */
  function ownsHomeEnd(target: EventTarget | null): boolean {
    if (inTextField(target) || target instanceof HTMLSelectElement) return true;
    if (target instanceof HTMLInputElement && target.type === 'range') return true;
    return inMenuOrDialog(target);
  }

  /** Whether a key was pressed in a dialog or a ⋯ menu, whose keys are for what's in it. */
  function inMenuOrDialog(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('dialog, [role="menu"]') !== null;
  }

  /** Where the playhead is, playing or paused, in seconds to the millisecond, e.g. to cue a Line at. */
  function playheadAt(): number {
    return transport.playheadAt();
  }

  // Sync mode reads the Loop, recording, the Clips and the playhead while
  // the Timeline's mounted: see syncMode.svelte.ts. Coming on, it switches
  // the Loop off: playback goes on without it at once, and with it again if
  // that fails.
  onMount(() =>
    syncMode.attach({
      get loopOn() {
        return loopOn;
      },
      stopLoop: () => {
        if (loopOn) editing.edit({ kind: 'switchLoop', on: false });
      },
      get recording() {
        return recording;
      },
      // As saved, as the Lyric Sheet's Cue gutter reads them.
      get hasClips() {
        return saves.timeline.tracks.some((t) => t.clips.length > 0);
      },
      playheadAt,
    }),
  );

  /** Adds a Beat to the chosen Track, after its last Clip or at 0:00. */
  async function addBeat(beat: Beat) {
    picking = false;
    if (chosen === null) return; // Never: a Song always has a Track.
    const ok = (await editing.edit({ kind: 'addBeat', trackId: chosen, beatId: beat.id })) !== null;
    // Never copied without asking.
    if (ok && song.bpm === null && beat.bpm !== null) offerBpm = { bpm: beat.bpm, title: beat.title };
  }

  function useBpm() {
    if (offerBpm) setBpm(offerBpm.bpm);
    offerBpm = null;
  }

  /** Adds a Track at the bottom, which is chosen once it's saved. */
  function addTrack() {
    editing.edit({ kind: 'addTrack', track: { name: `Track ${timeline.tracks.length + 1}` } });
  }

  // The largest audio file the server takes, checked before importing one.
  let maxUploadBytes = $state(Infinity);
  api.getConfig().then(
    (c) => (maxUploadBytes = c.maxUploadBytes),
    // The server still enforces its limit.
    () => {},
  );
  // What went wrong here, then what the files imported since refused.
  const shownError = $derived([error, editing.error].filter((e) => e !== null).join(' ') || null);

  /**
   * Shows what went wrong here, or with null clears it, replacing what the
   * Timeline said before, what the files imported refused included.
   */
  function showError(message: string | null) {
    error = message;
    editing.dismissError();
  }

  /**
   * Imports audio files as Sounds onto a Track, each after the last, from
   * Import audio… or dropped, unless frozen: see Timeline editing. A new
   * import clears what the Timeline said before, unless one's under way.
   */
  function importFiles(files: File[], trackId: number) {
    if (frozen) return;
    if (editing.importing === null) showError(null);
    void editing.importFiles(files, trackId);
  }

  /** Imports the file picked with Import audio… onto the Chosen Track. */
  function importPicked(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file && chosen !== null) importFiles([file], chosen);
  }

  // The transport row's ⋯, for its occasional actions, and what they open:
  // the file picker for Import audio…, the Mixdown dialog, and the
  // recording settings, placed by the ⋯.
  let importInput: HTMLInputElement;
  let inputSettings: InputSettings;
  let transportMore = $state<HTMLElement>();
  let mixingDown = $state(false);
  const transportMenu = $derived(
    transportActions(
      {
        // Only there can the Timeline be edited.
        fullTimeline: editable.current,
        importing: editing.importing !== null,
        recording,
        merging: freeze === 'merging',
        chosenTrack: timeline.tracks.find((t) => t.id === chosen)?.name ?? 'the Chosen Track',
        hasClips: clips.length > 0,
      },
      {
        importAudio: () => importInput.click(),
        mixDown: () => (mixingDown = true),
        // Chosen from the ⋯, so it's there to place them by.
        recordingSettings: () => {
          if (transportMore) inputSettings.openSettings(transportMore);
        },
      },
    ),
  );

  // Audio files dragged from outside the page onto a Track are imported
  // onto it, and onto the Chosen Track below the last Track: only which
  // Track, never where on it. Not while the Timeline can't be edited, or
  // while recording, nor while its Tracks are hidden or a dialog is open
  // over it. Anywhere else, a file dropped is never opened by the browser
  // in place of the Song.
  let tracksElement = $state<HTMLElement>();
  // The Track files dragged over the Timeline would go to.
  let fileTarget = $state<number | null>(null);

  /** Whether files dropped now can be imported. */
  function takesFiles(): boolean {
    return editable.current && !frozen && !picking && !calibrating && !mixingDown && tracksShown;
  }

  /**
   * The Track files dropped this far down the page go to, or null where
   * they'd do nothing. Unlike a Clip dragged, which goes to the nearest
   * Track, files go nowhere above the first Track.
   */
  function fileTrackAt(y: number): number | null {
    if (!takesFiles() || !tracksElement || chosen === null) return null;
    const rows: TrackRow[] = [];
    for (const [i, track] of timeline.tracks.entries()) {
      const lane = laneElements[i];
      if (!lane) return null;
      const { top, bottom } = lane.getBoundingClientRect();
      rows.push({ trackId: track.id, top, bottom });
    }
    return fileDropTrack(y, tracksElement.getBoundingClientRect(), rows, chosen);
  }

  function filesOver(event: DragEvent) {
    const files = draggedFiles(event);
    if (!files) return;
    event.preventDefault();
    fileTarget = fileTrackAt(event.clientY);
    files.dropEffect = fileTarget === null ? 'none' : 'copy';
  }

  // Leaving one of its elements for another fires too, so only once the
  // pointer is outside the Timeline.
  function filesLeave(event: DragEvent) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const { clientX: x, clientY: y } = event;
    if (x <= box.left || x >= box.right || y <= box.top || y >= box.bottom) fileTarget = null;
  }

  function filesDrop(event: DragEvent) {
    const files = draggedFiles(event);
    if (!files) return;
    event.preventDefault();
    fileTarget = null;
    const trackId = fileTrackAt(event.clientY);
    if (trackId !== null && files.files.length > 0) importFiles([...files.files], trackId);
  }

  /** Stops files dropped outside the Timeline from being opened by the browser. */
  function refuseFiles(event: DragEvent) {
    const files = draggedFiles(event);
    if (event.defaultPrevented || !files) return;
    event.preventDefault();
    files.dropEffect = 'none';
  }

  // Why Record can't work, where that's known before trying, e.g. no inputs:
  // checked again as inputs come and go.
  let recordProblem = $state<string | null>(null);

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

  // Calibration while it runs, of the Latency Offset shared by this
  // device's tabs: offered before the first recording here, where the Clip
  // to retake waits for it, or run from the recording settings.
  let calibrating = $state<{ offer: boolean; retaking?: Clip } | null>(null);
  // Whether calibration was just skipped, to say where to run it later.
  let skipped = $state(false);

  function storeCalibrated(offset: number) {
    // Applied even where storage can't keep it, until reload.
    calibration.set({ offset, offered: true });
  }

  function skipOffer() {
    calibration.set({ ...calibration.value, offered: true });
    skipped = true;
  }

  function calibrationClosed(record: boolean) {
    const { retaking } = calibrating ?? {};
    calibrating = null;
    if (record) startRecording(retaking);
  }

  const canRecord = $derived(
    recorder.phase === null &&
      freeze !== 'merging' &&
      playerState === 'stopped' &&
      !syncMode.on &&
      !calibrating &&
      !recorder.recovering &&
      editable.current,
  );

  $effect(() => {
    onRecording?.(recording);
  });

  /**
   * Records a Take onto the chosen Track, or with retaking, into that Clip
   * of Takes.
   */
  function startRecording(retaking?: Clip) {
    // No Retake while several Clips are selected, e.g. selected while
    // calibration, offered first, ran.
    if (!canRecord || (retaking && selection.size > 1)) return;
    // Calibration is offered first, the first time on this device.
    if (!calibration.value.offered && calibration.value.offset === null) {
      calibrating = { offer: true, retaking };
      return;
    }
    showError(null);
    // Resumed right away, while the key press or click still counts.
    audioContext()
      .resume()
      .catch(() => {});
    recorder.start({ trackId: chosen, playhead: position, retake: retaking?.id });
  }

  async function stopRecording() {
    await recorder.stop();
    // Said once, for the recording right after skipping.
    skipped = false;
  }

  // Left from an earlier visit to this Song, e.g. by a crashed tab.
  $effect(() => {
    untrack(() => recorder.loadUnsaved());
  });

  /** Keeps the unsaved Takes offered, one after another, until one can't be. */
  function keepUnsaved() {
    if (recorder.recovering || frozen) return;
    showError(null);
    recorder.keepUnsaved();
  }

  function discardUnsaved() {
    if (frozen) return;
    recorder.discardUnsaved();
  }

  function switchRecording() {
    if (capturing) stopRecording();
    else startRecording();
  }

  // The chosen Track, which a recording or a Beat goes to, kept on this
  // device for each Song. Choosing isn't an edit, so it's never saved with
  // the Song.
  // Read again only for another Song: the Song is replaced after every edit.
  const songId = $derived(song.id);
  let remembered = $derived(readChosen(deviceStorage(), songId));
  const chosen = $derived(chosenTrack(timeline.tracks, remembered));

  function choose(event: ChoiceEvent) {
    // Not while recording, which goes where it was chosen as it started.
    if (frozen) return;
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

  // Dragging from empty lane space draws a box, and the Clips it touches
  // on the Tracks it spans become the Selection as it's drawn, or, with
  // Mod held as it's pressed, are added to it. It leaves the Chosen Track
  // and the playhead be, and scrolls the lanes along near their edges, as
  // a Clip dragged does. A press let go without moving past the slop is a
  // click there instead, an insertion point: it clears the Selection,
  // moves the playhead to exactly where it was pressed, unsnapped, as the
  // ruler does, and chooses that Track, so a paste, a recording or
  // "+ Beat" goes there. With Mod held, that was likely the start of a
  // box to add, so it leaves the Selection, the playhead and the Chosen
  // Track be. A finger dragging pans the lanes instead: a tap does what a
  // click does, and it draws a box only once held still for a long press, and that
  // box always replaces the Selection; let go without dragging, it only
  // clears the Selection. A second finger, e.g. pinching, gives the box
  // up.
  interface LaneBox {
    /** The press, telling a click, a box and a pan apart. */
    press: LanePress;
    pointerId: number;
    /** The box's hold on the Selection, which it replaces or adds to as it was pressed. */
    selectionBox: SelectionBox;
    /** Where it was pressed, in seconds: the box's start. */
    start: number;
    /** The index of the Track whose lane was pressed. */
    trackIndex: number;
    /** How far down the lanes it was pressed, in pixels. */
    top: number;
  }
  let laneBox: LaneBox | null = null;
  /** The box being drawn, in seconds across and pixels down the lanes, once the press has moved past the slop or a finger's been held. */
  let box = $state<{ start: number; end: number; top: number; bottom: number } | null>(null);
  /** Waiting for a finger on empty lane space to be held still long enough to draw a box. */
  let laneTimer: ReturnType<typeof setTimeout> | undefined;

  /** How far a point is down the lanes, in pixels. */
  function yIn(clientY: number): number {
    return clientY - lanesElement!.getBoundingClientRect().top;
  }

  /** The index of the Track whose lane is nearest to a height on the page. */
  function trackIndexAt(clientY: number): number {
    const id = trackAt(clientY);
    return timeline.tracks.findIndex((t) => t.id === id);
  }

  /** Whether a finger is drawing a box, so the lanes mustn't pan under it. */
  function touchBoxing(): boolean {
    return laneBox?.press.touch === true && laneBox.press.phase === 'boxing';
  }

  function laneDown(event: PointerEvent) {
    if (event.target !== event.currentTarget || !editable.current || !event.isPrimary || event.button !== 0) return;
    // Not selecting the page's text as it's drawn. Focus goes to the lanes,
    // so the Timeline's keys, e.g. Esc and Mod+A, work after it.
    event.preventDefault();
    lanesElement!.focus({ preventScroll: true });
    const touch = event.pointerType === 'touch';
    const adds = addsBox(event);
    laneBox = {
      press: pressLane(event, touch, adds),
      pointerId: event.pointerId,
      selectionBox: selection.startBox(adds),
      start: spanTimeAt(event.clientX),
      trackIndex: trackIndexAt(event.clientY),
      top: yIn(event.clientY),
    };
    if (laneBox.press.phase === 'holding') laneTimer = setTimeout(laneHold, longPressDelay);
    window.addEventListener('pointerdown', laneOtherDown);
    window.addEventListener('pointermove', laneMove);
    window.addEventListener('pointerup', laneUp);
    window.addEventListener('pointercancel', laneCancel);
  }

  /** Steps the press on, drawing the box to `at` or ending the press as it says. */
  function laneInput(input: LaneInput, at: Point) {
    if (!laneBox) return;
    const { press, outcome } = laneStep(laneBox.press, input);
    if (press) laneBox.press = press;
    switch (outcome) {
      case 'wait':
        return;
      case 'box':
        drawBox(laneBox, at);
        return;
      case 'insertionPoint': {
        selection.apply({ kind: 'emptyClick', adds: false });
        // Not even following the playhead again while recording.
        if (frozen) break;
        seekTo(laneBox.start);
        const track = timeline.tracks[laneBox.trackIndex];
        if (track) choose({ kind: 'choose', trackId: track.id });
        break;
      }
      case 'click':
        selection.apply({ kind: 'emptyClick', adds: laneBox.press.adds });
        break;
      case 'restore':
        laneBox.selectionBox.restore();
        break;
      case 'keep':
      case 'giveUp':
        break;
    }
    laneDone();
  }

  function drawBox({ start, trackIndex, top, selectionBox }: LaneBox, at: Point) {
    const end = spanTimeAt(at.clientX);
    box = { start, end, top, bottom: yIn(at.clientY) };
    selectionBox.draw({ start, end, tracks: [trackIndex, trackIndexAt(at.clientY)] });
    dragAt(at, laneMove);
  }

  // Held still, a finger draws a box from under it, with a buzz where the
  // device has one. Not while recording, when the Selection is locked.
  function laneHold() {
    if (!laneBox) return;
    if (frozen) return laneDone();
    navigator.vibrate?.(15);
    laneInput({ kind: 'hold' }, laneBox.press.from);
  }

  function laneMove(event: Point) {
    if ('pointerId' in event && event.pointerId !== laneBox?.pointerId) return;
    laneInput({ kind: 'move', at: event }, event);
  }

  function laneUp(event: PointerEvent) {
    if (event.pointerId !== laneBox?.pointerId) return;
    laneMove(event);
    laneInput({ kind: 'lift' }, event);
  }

  // A box given up, e.g. for a pinch or a scroll on touch, selects what was
  // selected before it.
  function laneCancel(event: PointerEvent) {
    if (event.pointerId !== laneBox?.pointerId) return;
    laneInput({ kind: 'cancel' }, event);
  }

  // A second finger landing, e.g. to pinch, gives a finger's box up.
  function laneOtherDown(event: PointerEvent) {
    if (!laneBox?.press.touch || event.pointerId === laneBox.pointerId) return;
    laneInput({ kind: 'cancel' }, event);
  }

  // A finger's long press opens no menu of the browser's on empty lane space.
  function laneContextMenu(event: MouseEvent) {
    if (laneBox?.press.touch) event.preventDefault();
  }

  function laneDone() {
    laneBox = null;
    box = null;
    clearTimeout(laneTimer);
    dragDone();
    window.removeEventListener('pointerdown', laneOtherDown);
    window.removeEventListener('pointermove', laneMove);
    window.removeEventListener('pointerup', laneUp);
    window.removeEventListener('pointercancel', laneCancel);
  }
  onDestroy(laneDone);

  // The Clipboard: the Clips last copied or cut from the Selection, as they
  // were then. Like the Selection, it's never kept, so leaving the Song
  // drops it, and undo and redo never change it.
  let clipboard = $state.raw<Clipboard>(emptyClipboard);

  /** Copies the Selection to the Clipboard; with none, the Clipboard stays as it was. */
  function copySelection() {
    copyClips(selection.ids);
  }

  /** Copies these Clips to the Clipboard; with none, the Clipboard stays as it was. */
  function copyClips(clipIds: ClipIds) {
    clipboard = copy(timeline.tracks, clipIds) ?? clipboard;
  }

  /**
   * Cuts the Selection: copies it to the Clipboard, then deletes it, as one
   * edit to undo, which leaves the Clipboard as it is. A cut Clip of Takes
   * pastes from its Takes, which deleting only detaches.
   */
  function cutSelection() {
    copySelection();
    removeSelection();
  }

  /** Cuts a Clip alone, from its menu: copies it, then deletes it, as one edit to undo. */
  function cutClip(clip: Clip) {
    copyClips(new Set([clip.id]));
    remove(clip);
  }

  /**
   * Pastes the Clipboard at the playhead on the Chosen Track, or later
   * where it fits, the playhead staying where it is, adding Tracks at the
   * bottom for rows that run past the last, and selects the Clips pasted.
   */
  function pasteClipboard() {
    if (chosen === null) return; // Never: a Song always has a Track.
    const pasted = paste(clipboard, timeline.tracks, playheadAt(), chosen);
    if (pasted) pasteAndSelect(pasted);
  }

  /** Makes the Clips of a paste, or a Selection Duplicate, as one edit, and selects them. */
  function pasteAndSelect(pasted: Paste) {
    editing.edit({ kind: 'pasteClips', ...pasted });
  }

  // The Selection's and a focused Clip's keys, pressed anywhere in the
  // Timeline: `timelineKey` decides what each does and when, and this only
  // dispatches it.
  function timelineKeyDown(event: KeyboardEvent) {
    const clip = focusedClip(event.target);
    const action = timelineKey(event, {
      inTextField: inTextField(event.target),
      inMenuOrDialog: inMenuOrDialog(event.target),
      editable: editable.current,
      freeze,
      selected: selection.size,
      focusedClip: clip && { inSelection: selection.has(clip.id) },
      draggingTrack: trackDrag.current !== null,
    });
    if (!action) return;
    event.preventDefault();
    switch (action) {
      case 'clearSelection':
        return selection.apply({ kind: 'clear' });
      case 'selectAll':
        return selection.apply({ kind: 'all' });
      case 'deleteSelection':
        return removeSelection();
      case 'copy':
        return copySelection();
      case 'cut':
        return cutSelection();
      case 'paste':
        return pasteClipboard();
      // Only ever given with a focused Clip.
      case 'deleteClip':
        return clip && remove(clip);
      case 'clipMenu':
        return clip && openClipMenu(clip, event.target as HTMLElement);
      default:
        return action satisfies never;
    }
  }

  /** The Clip a key was pressed on, if it has focus itself, not e.g. its ⋯ or its name's field. */
  function focusedClip(target: EventTarget | null): Clip | null {
    if (!(target instanceof HTMLElement) || !target.matches('.clip[id^="clip-"]')) return null;
    const id = Number(target.id.slice('clip-'.length));
    return clips.find((c) => c.id === id) ?? null;
  }

  // Moving, trimming and nudging a Clip, moving the Selection, and setting
  // a Clip's Gain or Fades by dragging go through ClipDrag (see
  // clipDrag.svelte.ts), with the page measured here.
  const clipDrag = new ClipDrag(selection, {
    tracks: () => timeline.tracks,
    playhead: () => position,
    loop: () => loop,
    reach: () => reachAt(view.scale),
    sourceLength: (clip) => sources.of(clip).duration,
  });

  /** Where a point is, for ClipDrag: the time under it across the lanes and the Track whose lane is nearest. */
  function clipDragAt(at: Point): DragAt {
    return {
      point: { clientX: at.clientX, clientY: at.clientY },
      time: spanTimeAt(at.clientX),
      trackId: trackAt(at.clientY),
    };
  }

  let lanesElement = $state<HTMLElement>();
  let lanesWrapElement = $state<HTMLElement>();
  let laneElements = $state<HTMLElement[]>([]);
  let rulerElement = $state<HTMLElement>();

  /**
   * Each Track's Clips as shown, with the one being edited where it's been
   * dragged to, or every selected Clip, when they're moved together.
   */
  const shown = $derived.by(() => {
    // Until it's dragged, the Clip pressed stays where it is among the
    // others: moved in the page, it would never get its click, or double-click.
    const moving = clipDrag.shown;
    const away = new Set(moving.map((m) => m.clip.id));
    const pressed = clipDrag.clip?.id;
    return timeline.tracks.map((track) => {
      const placed = track.clips
        .filter((c) => !away.has(c.id))
        .map((clip) => ({ clip, at: clip as Placed, editing: clip.id === pressed }));
      for (const m of moving) {
        if (m.trackId === track.id) placed.push({ clip: m.clip, at: m.at, editing: true });
      }
      return { track, clips: placed };
    });
  });

  /**
   * The guide for what a moved or trimmed Clip, or the Loop being set, is
   * snapped to: a line at that time, from the lane of the Clip whose edge
   * snapped through every lane with a Clip aligned there, and up through
   * the ruler for a Loop edge or the Loop, in pixels down the lanes. None
   * for the playhead, which already is a line.
   */
  const guide = $derived.by(() => {
    const clipSnap = clipDrag.snap;
    const snapped = clipSnap ?? loopDrag.snap;
    if (!snapped) return null;
    const dragged = clipSnap ? timeline.tracks.findIndex((t) => t.id === clipSnap.trackId) : 'ruler';
    const lanes = guideLanes(dragged, snapped.aligned);
    if (!lanes) return null;
    const top = lanes.from === 'ruler' ? rulerElement : laneElements[lanes.from];
    const bottom = laneElements[lanes.to];
    if (!top || !bottom) return null;
    return { at: snapped.at, top: top.offsetTop, height: bottom.offsetTop + bottom.offsetHeight - top.offsetTop };
  });

  function trackOf(clip: Clip) {
    return timeline.tracks.find((t) => t.clips.some((c) => c.id === clip.id))!;
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
  // default, which follows the window. A height dragged on this device is
  // the least this Song's area starts at.
  let chosenHeight = $state<number | null>(readHeight(deviceStorage()));
  let headsHeight = $state(0);
  let lanesHeight = $state(0);
  let resizing: { y: number; height: number; moved: boolean } | null = null;
  const windowHeight = $derived(innerHeight.current ?? 0);
  /** How tall the Tracks and the ruler are, or 0 while unknown (e.g. hidden). */
  const neededHeight = $derived(Math.max(headsHeight, lanesHeight));

  const bounds = $derived.by(() => {
    // One Track and the ruler above it.
    const first = laneElements[0];
    const least = first ? first.offsetTop + first.offsetHeight : 0;
    return heightBounds(windowHeight, least, neededHeight);
  });

  // A chosen height grows to fit the Tracks as they're known, and as they're
  // added while every one shows. The default already fits them.
  // Plain, not $state: only remembered from one run to the next.
  let neededBefore = 0;
  $effect(() => {
    const needed = neededHeight;
    if (!needed) return;
    untrack(() => {
      // Full-screen, the height kept for elsewhere is left as it is.
      if (chosenHeight !== null && !fullScreen.current) {
        chosenHeight = grownHeight(chosenHeight, neededBefore, needed, windowHeight);
      }
    });
    neededBefore = needed;
  });
  const tracksHeight = $derived(clampHeight(chosenHeight ?? defaultHeight(windowHeight), bounds));

  function resize(height: number) {
    chosenHeight = clampHeight(height, bounds);
  }

  function resizeDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resizing = { y: event.clientY, height: tracksHeight, moved: false };
  }

  function resizeMove(event: PointerEvent) {
    // Dragging up makes it taller.
    if (!resizing) return;
    if (event.clientY !== resizing.y) resizing.moved = true;
    resize(resizing.height + resizing.y - event.clientY);
  }

  function resizeUp() {
    if (!resizing) return;
    // A click that didn't drag keeps what's stored, not a height grown to fit.
    const { moved } = resizing;
    resizing = null;
    if (moved) storeHeight(deviceStorage(), chosenHeight);
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

  function editDown(event: PointerEvent, clip: Clip, grip: ClipGrip) {
    // Not even choosing its Track while recording.
    if (frozen) return;
    // Mod+clicking it to gather a Selection leaves the Chosen Track be.
    const toggles = togglesSelection(event);
    if (event.isPrimary && event.button === 0 && !toggles) choose({ kind: 'choose', trackId: trackOf(clip).id });
    const pressed = clipDrag.clip;
    if (!editable.current || !event.isPrimary || event.button !== 0 || pressed || inClipMenu(event.target)) return;
    event.stopPropagation();
    // Clicking a Clip still focuses it, for its keys and its menu.
    const element = (event.currentTarget as HTMLElement).closest<HTMLElement>('.clip')!;
    element.focus();
    event.preventDefault();
    // A finger held still opens the Clip's menu, as there's no right-click on touch.
    if (event.pointerType === 'touch') {
      const finger = { clientX: event.clientX, clientY: event.clientY };
      pressTimer = setTimeout(() => openClipMenu(clip, element, finger), longPressDelay);
    }
    // Its body moves it, or with Alt held nudges its active Take; an edge
    // trims it; its gain line sets its Gain, and a fade dot its Fade.
    const keys = { free: skipsSnapping(event), toggles, nudges: nudges(event) };
    clipDrag.press(clip, grip, clipDragAt(event), keys, measureClip(element, grip));
    window.addEventListener('pointermove', editMove);
    window.addEventListener('pointerup', editUp);
    window.addEventListener('pointercancel', editCancel);
    window.addEventListener('keydown', editModifier);
    window.addEventListener('keyup', editModifier);
  }

  /** Where the pointer last dragged a Clip to. */
  let editAt: Point = { clientX: 0, clientY: 0 };

  // A modifier pressed or let go mid-drag, e.g. the Shift that skips
  // snapping, or drags the gain line finely, goes there and then, without
  // waiting for the pointer to move.
  function editModifier(event: KeyboardEvent) {
    if (!isModifier(event.key) || !clipDrag.clip) return;
    clipDrag.modifier(skipsSnapping(event), clipDragAt(editAt));
  }

  /**
   * What ClipDrag needs of a Clip pressed by its gain line, how tall its
   * waveform is, or by a fade dot, where the dots are, in seconds, and how
   * far in from the Clip's edge one rests without a Fade: just inside the
   * trim edge.
   */
  function measureClip(clipElement: HTMLElement, grip: ClipGrip): ClipMeasure {
    if (grip === 'gain') return { waveHeight: clipElement.querySelector('.wave')?.getBoundingClientRect().height ?? 0 };
    if (!isFadeEnd(grip)) return {};
    const middle = (end: FadeEnd) => {
      const r = clipElement.querySelector(`.fade-dot.${end === 'fadeIn' ? 'in' : 'out'}`)!.getBoundingClientRect();
      return r.left + r.width / 2;
    };
    const width = clipElement.querySelector('.fade-dot')!.getBoundingClientRect().width;
    const trim = clipElement.querySelector('.trim')!.getBoundingClientRect();
    return {
      dots: {
        fadeIn: spanTimeAt(middle('fadeIn')),
        fadeOut: spanTimeAt(middle('fadeOut')),
        width: width / view.scale,
        rests: (trim.width + width / 2) / view.scale,
      },
    };
  }

  function editMove(event: Point) {
    // Scrolling along at an edge moves it too, with no keys to go by.
    const free = 'shiftKey' in event ? skipsSnapping(event as PointerEvent) : undefined;
    if (!clipDrag.move(clipDragAt(event), free)) return;
    clearTimeout(pressTimer);
    editAt = { clientX: event.clientX, clientY: event.clientY };
    // The gain line goes up and down only, so it never scrolls along.
    if (clipDrag.mode !== 'gain') dragAt(event, editMove);
  }

  async function editUp() {
    stopListening();
    const save = clipDrag.release();
    if (!save) return;
    // A move over Cues offers to move them along. A Gain or Fades, handed
    // over, show through Timeline editing until saved.
    await editing.saveDrag(save);
    clipDrag.saved(save);
  }

  function editCancel() {
    stopListening();
    clipDrag.cancel();
  }

  function stopListening() {
    clearTimeout(pressTimer);
    dragDone();
    window.removeEventListener('pointermove', editMove);
    window.removeEventListener('pointerup', editUp);
    window.removeEventListener('pointercancel', editCancel);
    window.removeEventListener('keydown', editModifier);
    window.removeEventListener('keyup', editModifier);
  }
  onDestroy(stopListening);

  function duplicate(clip: Clip) {
    editing.edit({ kind: 'duplicateClip', clipId: clip.id });
  }

  /**
   * Duplicates the selected Clips onto their Tracks, right after the
   * Selection ends or later where they all fit, as one edit, and selects
   * the copies. It leaves the Clipboard as it is.
   */
  function duplicateSelection() {
    const copies = duplicatePlacement(timeline.tracks, selection.ids);
    if (copies) pasteAndSelect(copies);
  }

  /**
   * Splits Clips in two at the playhead, as one edit, and selects the
   * right half of each: the selected Clips it crosses, or with none selected,
   * the Chosen Track's Clip under it; or, given, only those of clipIds it
   * crosses. With nothing to split, nothing happens. Focus on a Clip it
   * splits moves to its right half, so Delete then trims off what's after
   * the playhead, not the left half alone.
   */
  function splitAtPlayhead(clipIds?: ReadonlySet<number>) {
    if (frozen) return;
    const at = playheadAt();
    const splitting = splitTargets(timeline.tracks, clipIds ?? selection.ids, chosen, at);
    if (splitting.length === 0) return;
    const focused = focusedClip(document.activeElement)?.id;
    editing.edit({ kind: 'splitClips', clipIds: splitting, at }).then((edited) => {
      // Focus stays put while recording, as the Selection does, and once
      // it's moved on from the Clip since.
      if (!edited || focused === undefined || !splitting.includes(focused) || recording) return;
      if (document.activeElement?.id !== `clip-${focused}`) return;
      const right = rightHalfOf(edited.before, edited.after, focused);
      if (right !== null) tick().then(() => document.getElementById(`clip-${right}`)?.focus());
    });
  }

  // A Clip is renamed in place, like a Track: double-clicked, or from its
  // menu. A blank name clears its own, so it goes by its source's again
  // (see TimelineEditing.clipName). Until a new name is saved, it's shown.
  let renamingClip = $state.raw<{ clipId: number; name: TypedField<string | null> } | null>(null);

  /** What a Clip goes by, as shown. */
  function titleOf(clip: Clip): string {
    return clipTitle(clip, sources.of(clip));
  }

  function startClipRename(clip: Clip) {
    if (!editable.current || frozen || renamingClip?.clipId === clip.id) return;
    renamingClip = { clipId: clip.id, name: editing.clipName(clip.id) };
  }

  /** Stops renaming a Clip, saving the name typed unless asked not to. */
  function endClipRename(clip: Clip, save: boolean) {
    if (renamingClip?.clipId !== clip.id) return;
    if (save) renamingClip.name.commit();
    else renamingClip.name.cancel();
    renamingClip = null;
  }

  function clipNameKey(clip: Clip, event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    endClipRename(clip, event.key === 'Enter');
    // Back to the Clip, where renaming started.
    tick().then(() => document.getElementById(`clip-${clip.id}`)?.focus());
  }

  function clipDoubleClick(event: MouseEvent, clip: Clip) {
    // Not on its ⋯ or menu, its trim edges, or its name being typed.
    if (inClipMenu(event.target) || inClipName(event.target)) return;
    if (event.target instanceof Element && event.target.closest('.trim, .fade-dot')) return;
    // Its gain line resets the Gain instead.
    if (event.target instanceof Element && event.target.closest('.gain-line')) {
      if (clip.gain !== 0 && !frozen) editing.edit({ kind: 'setClipGain', clipId: clip.id, gain: 0 });
      return;
    }
    startClipRename(clip);
  }

  /** Whether an event came from the field a Clip's name is typed in. */
  function inClipName(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('.clip-name') !== null;
  }

  // Deleting doesn't ask first: it can be undone, and the Beat stays in the
  // Beat Library.
  function remove(clip: Clip) {
    editing.edit({ kind: 'deleteClip', clipId: clip.id });
  }

  /**
   * Merges the selected Clips into one Clip of a new Sound: see Timeline
   * editing. Pressing it clears what the Timeline said before.
   */
  function mergeSelection() {
    if (!editing.mergeable) return;
    showError(null);
    void editing.merge();
  }

  /** Deletes the selected Clips, as one edit. */
  function removeSelection() {
    editing.edit({ kind: 'deleteClips', clipIds: [...selection.ids] });
  }

  // Each Clip's menu, opened by its ⋯, right-click, the Menu key, Shift+F10
  // or a long press. On a Clip in a Selection of several, it's the
  // Selection menu, acting on them all; opened on a Clip outside the
  // Selection, that Clip becomes the Selection first.
  const clipMenus: Record<number, ActionsMenu> = {};
  // Waiting to open a Clip's menu, until the finger moves or lifts.
  let pressTimer: ReturnType<typeof setTimeout> | undefined;

  function clipMenuOpened(clip: Clip) {
    selection.openMenu(clip.id);
  }

  function clipMenuActions(clip: Clip): MenuAction[] {
    if (selection.menuFor(clip.id) === 'selection') {
      return selectionActions(
        selection.size,
        {
          copyClips: copySelection,
          cutClips: cutSelection,
          duplicateClips: duplicateSelection,
          splitClips: () => splitAtPlayhead(),
          mergeClips: mergeSelection,
          deleteClips: removeSelection,
        },
        {
          frozen: freeze,
          canMerge: mergeTarget(timeline.tracks, selection.ids) !== null,
          canSplit: splitTargets(timeline.tracks, selection.ids, chosen, playheadAt()).length > 0,
          ...menuKeys(),
        },
      );
    }
    const clipId = clip.id;
    return clipActions(
      clip,
      {
        canRecord,
        soundName: clip.soundId === null ? null : sources.of(clip).title,
        nudgeKeys: hints.label(shortcuts.nudgeTake.keys),
        ...menuKeys(),
        canSplit: splitTargets(timeline.tracks, new Set([clipId]), chosen, playheadAt()).length > 0,
        selected: selection.size,
        frozen: freeze,
      },
      {
        retake: () => startRecording(clip),
        chooseTake: (takeId) => editing.edit({ kind: 'chooseTake', clipId, takeId }),
        deleteTake: (takeId) => editing.edit({ kind: 'deleteTake', clipId, takeId }),
        nudgeTake: (takeId, ms) => editing.edit({ kind: 'nudgeTake', clipId, takeId, nudge: ms / 1000 }),
        clearInactiveTakes: () => editing.edit({ kind: 'clearInactiveTakes', clipId }),
        downloadTake: (takeId) => download(api.takeDownloadUrl(timeline.songId, takeId)),
        rename: () => startClipRename(clip),
        // To the tenth, as a drag sets it.
        setGain: (gain) => editing.edit({ kind: 'setClipGain', clipId, gain: clampGain(gain) }),
        copy: () => copyClips(new Set([clip.id])),
        cut: () => cutClip(clip),
        duplicate: () => duplicate(clip),
        split: () => splitAtPlayhead(new Set([clipId])),
        downloadSound: (soundId) => download(api.soundDownloadUrl(timeline.songId, soundId)),
        deleteClip: () => remove(clip),
      },
    );
  }

  /** The keys that copy, cut and split, as the Clip and Selection menus name them. */
  function menuKeys() {
    return {
      copyKeys: hints.label(shortcuts.copyClips.keys),
      cutKeys: hints.label(shortcuts.cutClips.keys),
      splitKeys: hints.label(shortcuts.splitClips.keys),
    };
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

  /** Whether an event came from inside a Clip's open menu, rather than its ⋯. */
  function inOpenMenu(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('.clip-menu [role="menu"]') !== null;
  }

  // At `point` by pointer, e.g. where it's right-clicked; else by its ⋯, by keyboard.
  function openClipMenu(clip: Clip, element: HTMLElement, point?: Point) {
    // Not while a Clip's edit is saving: it's then put back in its place,
    // which would take the menu out of the page under it.
    if (clipDrag.saving) return;
    // A press that opens the menu isn't a drag.
    if (clipDrag.clip) editCancel();
    // So its ⋯, which a menu opened by keyboard lines up with, shows, and
    // focus comes back to the Clip.
    element.focus();
    clipMenus[clip.id]?.openMenu(point);
  }

  function clipContextMenu(event: MouseEvent, clip: Clip) {
    // Its name's field keeps the browser's, to cut, copy and paste.
    if (inClipName(event.target)) return;
    // The Clip has a menu of its own, in place of the browser's.
    event.preventDefault();
    // Right-clicking its ⋯ opens it there too, but not right-clicking in it.
    if (!editable.current || clipDrag.moved || inOpenMenu(event.target)) return;
    openClipMenu(clip, event.currentTarget as HTMLElement, event);
  }

  // Setting the Loop by dragging along the top of the ruler goes through
  // LoopDrag (see loopDrag.svelte.ts), with the page measured here.
  const loopDrag = new LoopDrag({
    tracks: () => timeline.tracks,
    playhead: () => position,
    loop: () => timeline.loop,
    reach: () => reachAt(view.scale),
    span: () => span,
  });
  const loop = $derived(loopDrag.loop ?? timeline.loop);

  /** Where a point is, for LoopDrag: the time under it across the lanes. */
  function loopDragAt(at: Point): LoopAt {
    return { point: { clientX: at.clientX, clientY: at.clientY }, time: spanTimeAt(at.clientX) };
  }

  function loopDown(event: PointerEvent) {
    if (!editable.current || frozen || !event.isPrimary || event.button !== 0 || loopDrag.pressed) return;
    const edge = (event.target as HTMLElement).dataset.edge as 'start' | 'end' | undefined;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    loopDrag.press(edge ?? 'new', loopDragAt(event), skipsSnapping(event));
    window.addEventListener('keydown', loopModifier);
    window.addEventListener('keyup', loopModifier);
  }

  /** Where the pointer last dragged the Loop to. */
  let loopAt: Point = { clientX: 0, clientY: 0 };

  // A modifier pressed or let go mid-drag, e.g. the Shift that skips
  // snapping, snaps or frees the Loop there and then, without waiting for
  // the pointer to move.
  function loopModifier(event: KeyboardEvent) {
    if (!isModifier(event.key)) return;
    loopDrag.modifier(skipsSnapping(event), loopDragAt(loopAt));
  }

  function loopMove(event: Point) {
    // Scrolling along at an edge moves it too, with no keys to go by.
    const free = 'shiftKey' in event ? skipsSnapping(event as PointerEvent) : undefined;
    if (!loopDrag.move(loopDragAt(event), free)) return;
    loopAt = { clientX: event.clientX, clientY: event.clientY };
    dragAt(event, loopMove);
  }

  function stopLoopListening() {
    dragDone();
    window.removeEventListener('keydown', loopModifier);
    window.removeEventListener('keyup', loopModifier);
  }
  onDestroy(stopLoopListening);

  function loopUp() {
    stopLoopListening();
    const save = loopDrag.release();
    if (save) editing.edit(save);
  }

  function loopCancel() {
    stopLoopListening();
    loopDrag.cancel();
  }

  function switchLoop() {
    if (!timeline.loop || frozen) return;
    editing.edit({ kind: 'switchLoop', on: !loopOn });
  }

  function clearLoop() {
    editing.edit({ kind: 'clearLoop' });
  }

  /** A stretch of the Timeline's position and width across it, cut off at its end. */
  function spanStyle(from: number, to: number): { left: string; width: string } {
    return { left: `${percent(from)}%`, width: `${Math.max(0, percent(Math.min(to, span) - from))}%` };
  }

  // Zooming and scrolling: Mod+wheel (Ctrl or ⌘) or pinching zooms in and
  // out around the pointer or the pinch, and the lanes scroll along when
  // zoomed in.
  // Zoomed all the way out (scale 0), the whole Timeline fits, however long.
  let scale = $state(0);
  let scroll = $state(0);
  let width = $state(0);
  const view = $derived(timelineView({ span, width, scale, scroll }));
  // Where the lanes were last scrolled to from here, to tell scrolling by
  // hand, which stops the playhead being followed.
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
  // bar isn't in them, so the browser wouldn't. Mod+wheel zooms, below.
  function barWheel(event: WheelEvent) {
    if (zooms(event)) return;
    const along = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    lanesElement!.scrollLeft += event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? along : along * 33;
  }

  function scrolled() {
    scroll = lanesElement!.scrollLeft;
    // Scrolled by hand, rather than to where it was shown.
    if (Math.abs(scroll - timelineView({ ...view, scroll: scrolledTo }).scroll) > 1) transport.stopFollowing();
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
      // So does a trackpad's pinch, which comes as a Ctrl wheel event.
      if (!zooms(event)) return;
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
      transport.cancelScrub();
      dragDone();
      loopCancel();
    };
    const touchMove = (event: TouchEvent) => {
      // A finger drawing a box draws it, rather than panning the lanes.
      if (touchBoxing()) event.preventDefault();
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
<svelte:window onkeydown={keydown} onpagehide={() => recorder.flush()} ondragover={refuseFiles} ondrop={refuseFiles} />

{#snippet undoRedo()}
  <span class="history edit-only">
    <button
      type="button"
      class="icon"
      onclick={undo}
      disabled={!saves.canUndo || frozen}
      aria-label="Undo"
      aria-keyshortcuts={hints.aria(shortcuts.undo.keys)}
      title={editHint(freeze, hints.withKeys('Undo', shortcuts.undo.keys))}><Undo2 /></button
    >
    <button
      type="button"
      class="icon"
      onclick={redo}
      disabled={!saves.canRedo || frozen}
      aria-label="Redo"
      aria-keyshortcuts={hints.aria(shortcuts.redo.keys)}
      title={editHint(freeze, hints.withKeys('Redo', shortcuts.redo.keys))}><Redo2 /></button
    >
  </span>
{/snippet}

{#snippet toStartOrEnd(going: Way)}
  {@const keys = shortcuts.startOrEnd[going]}
  {@const text = going === 'back' ? 'Go to the start' : 'Go to the end'}
  <button
    type="button"
    class="icon skip"
    onclick={() => seekTo(startOrEnd(going, length))}
    disabled={recording}
    aria-label={text}
    aria-keyshortcuts={hints.aria(keys)}
    title={recording ? 'Stop recording to move the playhead' : hints.withKeys(text, keys)}
  >
    {#if going === 'back'}<SkipBack />{:else}<SkipForward />{/if}
  </button>
{/snippet}

{#snippet status(text: string, tone: 'muted' | 'input-note' = 'muted')}
  <span class={['status', tone]} role="status" title={text}>{text}</span>
{/snippet}

<!-- Its keys, pressed anywhere in it, e.g. Esc on a focused control or Delete on a focused Clip, go to one listener. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="timeline"
  aria-label="Timeline"
  bind:offsetHeight={height}
  onkeydown={timelineKeyDown}
  ondragenter={filesOver}
  ondragover={filesOver}
  ondragleave={filesLeave}
  ondrop={filesDrop}
>
  {#if resizable}
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
      <span class="playback">
        {@render toStartOrEnd('back')}
        <button
          type="button"
          class="play"
          onclick={() => transport.toggle()}
          aria-label={playerState === 'stopped' ? 'Play' : 'Pause'}
          aria-keyshortcuts={hints.aria(shortcuts.playPause.keys)}
          title={hints.withKeys('Play or pause', shortcuts.playPause.keys)}
        >
          {#if playerState === 'stopped'}<Play />{:else}<Pause />{/if}
        </button>
        {@render toStartOrEnd('forward')}
      </span>
      <span class="time muted">{formatDuration(position)} / {formatDuration(length)}</span>
      <button
        type="button"
        class="toggle loop-toggle"
        class:edit-only={!timeline.loop}
        aria-pressed={loopOn}
        disabled={!timeline.loop || frozen}
        onclick={switchLoop}
        title={editHint(
          freeze,
          timeline.loop
            ? `Loop ${formatDuration(timeline.loop.start)} to ${formatDuration(timeline.loop.end)}`
            : 'Drag along the top of the ruler to set a Loop',
        )}>Loop</button
      >
      <button
        type="button"
        class="toggle record edit-only"
        aria-pressed={capturing}
        disabled={!capturing && !canRecord}
        onclick={switchRecording}
        aria-keyshortcuts={hints.aria(shortcuts.record.keys)}
        title={capturing
          ? hints.withKeys('Stop recording', [...shortcuts.record.keys, ...shortcuts.playPause.keys])
          : syncMode.on
            ? 'Leave Sync mode to record'
            : playerState !== 'stopped'
              ? 'Stop playback to record'
              : recordProblem
                ? recordProblem
                : hints.withKeys(
                    `Record a Take on ${timeline.tracks.find((t) => t.id === chosen)?.name ?? 'a new Track'}`,
                    shortcuts.record.keys,
                  )}
        ><span class="record-dot" aria-hidden="true"
          >{#if capturing}<Square />{:else}<Circle />{/if}</span
        >{capturing ? 'Stop' : 'Record'}</button
      >
      <input
        class="visually-hidden"
        type="file"
        accept="audio/*"
        tabindex="-1"
        aria-hidden="true"
        bind:this={importInput}
        onchange={importPicked}
      />
      <InputSettings
        bind:this={inputSettings}
        disabled={recording || !editable.current}
        offset={calibration.value.offset}
        onCalibrate={() => (calibrating = { offer: false })}
      />
      {#if calibration.value.offset === null && !recording}
        <button
          type="button"
          class="not-calibrated edit-only"
          disabled={!canRecord}
          title="Takes are placed by the latency the browser reports until it's calibrated. Calibrate it now, or any time from Recording settings… in the ⋯ menu."
          onclick={() => (calibrating = { offer: false })}>Not calibrated</button
        >
      {/if}
      <!-- On one line full-screen, cut short with the whole of it in the title. -->
      {#if recorder.phase === 'starting'}
        {@render status('Opening the microphone…')}
      {:else if recorder.phase === 'saving'}
        {@render status('Saving the Take…')}
      {:else if recording && recorder.inputNote}
        {@render status(recorder.inputNote, 'input-note')}
      {:else if recording && skipped}
        {@render status('Calibrate the latency any time from Recording settings… in the ⋯ menu.')}
      {:else if editing.importing}
        {@render status(editing.importing)}
      {:else if playerState === 'loading'}
        {@render status('Loading audio…')}
      {/if}
      <span class="spacer"></span>
      {@render undoRedo()}
      <span class="transport-more" bind:this={transportMore}>
        <ActionsMenu label="More Timeline actions" entries={transportMenu} />
      </span>
      <button
        type="button"
        class="icon collapse-toggle"
        onclick={() => (collapsed = !collapsed)}
        aria-expanded={!collapsed}
        aria-controls="timeline-tracks"
        aria-label={collapsed ? 'Show the Timeline' : 'Hide the Timeline'}
      >
        {#if collapsed}<ChevronUp />{:else}<ChevronDown />{/if}
      </button>
    </div>

    <div
      class="tracks"
      id="timeline-tracks"
      bind:this={tracksElement}
      class:frozen
      hidden={!tracksShown}
      style:max-height={fullScreen.current ? null : `${tracksHeight}px`}
      onscroll={() => trackDrag.aim()}
    >
      <div class="heads" class:gripped={editable.current} bind:offsetHeight={headsHeight}>
        <div class="ruler-gap">
          <button
            type="button"
            class="button add edit-only"
            onclick={() => (picking = true)}
            disabled={frozen}
            title={editHint(
              freeze,
              `Add a Beat to ${timeline.tracks.find((t) => t.id === chosen)?.name ?? 'the Chosen Track'}`,
            )}><Plus />Beat</button
          >
          <button
            type="button"
            class="button add edit-only"
            aria-label="Add a Track"
            onclick={addTrack}
            disabled={frozen}
            title={editHint(freeze, undefined)}><Plus />Track</button
          >
        </div>
        {#each timeline.tracks as track, i (track.id)}
          <!-- Clicking it outside its controls chooses the Track, pointer only for now, like dragging Clips. -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
          <div
            class="head"
            class:chosen={track.id === chosen}
            class:file-target={track.id === fileTarget}
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
                {...trackDrag.on ? trackDrag.grip(i, dropTrack) : {}}
                >{#if trackDrag.on}<GripVertical />{/if}</span
              >
            {/if}
            <div class="head-row">
              {#if editable.current && renaming?.trackId === track.id}
                <input
                  class="name"
                  bind:value={renaming.name.shown}
                  aria-label="Name of Track {track.name}"
                  onkeydown={(e) => nameKey(track, e)}
                  onblur={() => endRename(track, true)}
                  {@attach focusField}
                  {@attach committedAsItGoes(renaming.name)}
                />
              {:else}
                <button
                  type="button"
                  class="name"
                  aria-label="Choose {track.name}"
                  disabled={frozen}
                  title={editHint(freeze, undefined)}
                  onclick={() => choose({ kind: 'choose', trackId: track.id })}
                  ondblclick={() => editable.current && startRename(track)}>{track.name}</button
                >
              {/if}
              {#if editable.current}
                <span class="track-actions">
                  <button
                    type="button"
                    id="rename-track-{track.id}"
                    class="rename"
                    onclick={() => startRename(track)}
                    disabled={frozen}
                    aria-label="Rename {track.name}"
                    title={editHint(freeze, 'Rename')}
                  >
                    <Pencil />
                  </button>
                  <button
                    type="button"
                    onclick={() => shift(i, -1)}
                    disabled={i === 0 || frozen}
                    aria-label="Move {track.name} up"
                    title={editHint(freeze, 'Move up')}><ArrowUp /></button
                  >
                  <button
                    type="button"
                    onclick={() => shift(i, 1)}
                    disabled={i === timeline.tracks.length - 1 || frozen}
                    aria-label="Move {track.name} down"
                    title={editHint(freeze, 'Move down')}><ArrowDown /></button
                  >
                  <button
                    type="button"
                    onclick={() => removeTrack(track)}
                    disabled={lastTrack || frozen}
                    aria-label="Delete {track.name} and its Clips"
                    title={editHint(
                      freeze,
                      lastTrack
                        ? "A Song always has a Track, so its last one can't be deleted"
                        : 'Delete the Track and its Clips',
                    )}><X /></button
                  >
                </span>
              {/if}
            </div>
            <div class="head-row">
              <button
                type="button"
                class="toggle mute"
                aria-pressed={track.muted}
                onclick={() => setLevels(track, { muted: !track.muted })}
                aria-label="Mute {track.name}"
                title="Mute">M</button
              >
              <button
                type="button"
                class="toggle solo"
                aria-pressed={track.soloed}
                onclick={() => setLevels(track, { soloed: !track.soloed })}
                aria-label="Solo {track.name}"
                title="Solo">S</button
              >
              <input
                class="volume"
                type="range"
                min={minVolume}
                max={maxVolume}
                step="0.5"
                value={track.volume}
                aria-label="Volume of {track.name}"
                aria-valuetext={formatVolume(track.volume)}
                title="{formatVolume(track.volume)} (double-click for 0 dB)"
                oninput={(e) => editing.moveFader(track.id, Number(e.currentTarget.value))}
                onchange={(e) => editing.letGoFader(track.id, Number(e.currentTarget.value))}
                onpointerdown={(e) => grabFader(track.id, e.currentTarget)}
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
          tabindex="-1"
          bind:clientWidth={width}
          bind:offsetHeight={lanesHeight}
          onscroll={scrolled}
        >
          <div class="content" style:width="{span * view.scale}px">
            <!-- Pointer only, like dragging Clips; the Loop is switched on and off with its button. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="loop-bar"
              class:editable={editable.current && !frozen}
              title={editable.current ? editHint(freeze, 'Drag to set a Loop') : undefined}
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
                  <span
                    class="loop-edge start edit-only"
                    data-edge="start"
                    title={editHint(freeze, "Drag to move the Loop's start")}
                  ></span>
                  <button
                    type="button"
                    class="loop-clear edit-only"
                    onpointerdown={(e) => e.stopPropagation()}
                    onclick={clearLoop}
                    disabled={frozen}
                    aria-label="Clear the Loop"
                    title={editHint(freeze, 'Clear the Loop')}><X /></button
                  >
                  <span
                    class="loop-edge end edit-only"
                    data-edge="end"
                    title={editHint(freeze, "Drag to move the Loop's end")}
                  ></span>
                </div>
              {/if}
            </div>
            <div
              class="ruler"
              bind:this={rulerElement}
              role="slider"
              tabindex="0"
              aria-label="Position"
              aria-valuemin={0}
              aria-valuemax={Math.round(span)}
              aria-valuenow={Math.round(position)}
              aria-valuetext="{formatDuration(position)} of {formatDuration(length)}"
              aria-keyshortcuts={hints.aria(rulerKeys)}
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
              <!-- Pointer only: clicking its empty space clears the Selection, as Esc does, and moves the playhead there, as the ruler does, choosing this Track. -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="lane"
                class:file-target={track.id === fileTarget}
                class:dragged={trackDrag.current?.from === t}
                class:drop-above={trackGap === t}
                class:drop-below={trackGap === shown.length && t === shown.length - 1}
                bind:this={laneElements[t]}
                onpointerdown={laneDown}
                oncontextmenu={laneContextMenu}
              >
                {#each placed as { clip, at, editing } (clip.id)}
                  {@const wave = waveWindow(view, at.start, at.length)}
                  {@const title = titleOf(clip)}
                  {@const isSelected = selection.has(clip.id)}
                  {@const extent = `${formatDuration(at.start)} to ${formatDuration(at.start + at.length)}`}
                  <!-- As trimmed, so a trim being dragged shortens them to fit, as saving it will. -->
                  {@const fades = fitFades(clip, at.length)}
                  <!-- Focusable for its Delete and menu keys; pointer dragging has no key equivalent yet, and its actions are in its menu. -->
                  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
                  <div
                    id="clip-{clip.id}"
                    class="clip"
                    class:editing
                    class:moving={editing && clipDrag.mode === 'move'}
                    class:nudging={editing && clipDrag.mode === 'nudge'}
                    class:gaining={editing && clipDrag.mode === 'gain'}
                    class:fading={editing && isFadeEnd(clipDrag.mode)}
                    class:retaking={clip.id === recorder.clipId}
                    class:selected={isSelected}
                    style:left="{percent(at.start)}%"
                    style:width="{percent(at.length)}%"
                    {title}
                    role="group"
                    aria-label="{title}{isSelected ? ', selected' : ''}, {extent}{clip.gain !== 0
                      ? `, ${formatGain(clip.gain)}`
                      : ''}{fades.fadeIn > 0 ? `, fade in ${formatFade(fades.fadeIn)}` : ''}{fades.fadeOut > 0
                      ? `, fade out ${formatFade(fades.fadeOut)}`
                      : ''}"
                    tabindex={editable.current ? 0 : undefined}
                    aria-keyshortcuts={editable.current
                      ? hints.aria(frozen ? shortcuts.clipMenu.keys : clipKeys)
                      : undefined}
                    onpointerdown={(e) => editDown(e, clip, 'move')}
                    oncontextmenu={(e) => clipContextMenu(e, clip)}
                    ondblclick={(e) => clipDoubleClick(e, clip)}
                  >
                    <span class="clip-head">
                      {#if editable.current && renamingClip?.clipId === clip.id}
                        <!-- Pressed, it's typed in, so the Clip doesn't move. -->
                        <input
                          class="clip-name"
                          bind:value={renamingClip.name.shown}
                          placeholder={sources.of(clip).title}
                          aria-label="Name of {title}"
                          onpointerdown={(e) => e.stopPropagation()}
                          onkeydown={(e) => clipNameKey(clip, e)}
                          onblur={() => endClipRename(clip, true)}
                          {@attach focusField}
                          {@attach committedAsItGoes(renamingClip.name)}
                        />
                      {:else}
                        <span class="clip-title">{title}</span>
                      {/if}
                      {#if clip.gain !== 0}
                        <span class="clip-gain">{formatGain(clip.gain)}</span>
                      {/if}
                      <span class="clip-actions clip-menu edit-only">
                        <ActionsMenu
                          bind:this={clipMenus[clip.id]}
                          label="More actions for {title}"
                          entries={clipMenuActions(clip)}
                          onopen={() => clipMenuOpened(clip)}
                        >
                          {#snippet trigger()}<span class="clip-more"><Ellipsis /></span>{/snippet}
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
                            <!-- Drawn as it sounds, at the Clip's Gain, shaped by its Fades. -->
                            {@const t = wave.from + ((i + 0.5) * barWidth) / view.scale}
                            {@const height = Math.max(
                              2,
                              heardPeak(shapedPeak(peak, fades, at.length, t), clip.gain) * 100,
                            )}
                            <!-- A Take's clipping stays marked once it's saved; a Beat's or a Sound's isn't, often being mastered loud. -->
                            <rect
                              class:clipped={clip.activeTakeId !== null && peak >= clipping}
                              x={i + 0.15}
                              y={(100 - height) / 2}
                              width="0.7"
                              {height}
                            />
                          {/each}
                        </svg>
                      {/if}
                      <!-- Its Gain, 0 dB in the middle: a thin target, dragged up or down, or double-clicked back to 0 dB. -->
                      <span
                        class="gain-line edit-only"
                        class:changed={clip.gain !== 0}
                        style:--at={gainLineAt(clip.gain)}
                        style:--fade-in={fades.fadeIn / at.length}
                        style:--fade-out={fades.fadeOut / at.length}
                        aria-hidden="true"
                        title={editHint(
                          freeze,
                          `Gain ${formatGain(clip.gain)}: drag to change it, with Shift for fine steps, or double-click for 0 dB`,
                        )}
                        onpointerdown={(e) => editDown(e, clip, 'gain')}
                      ></span>
                      {#if fades.fadeIn > 0 || fades.fadeOut > 0}
                        <!-- Each Fade, a straight slope from the Clip's edge, silent, up to the gain line. -->
                        <svg
                          class="fade-slopes edit-only"
                          viewBox="0 0 {at.length} 1"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          {#if fades.fadeIn > 0}
                            <line x1="0" y1="1" x2={fades.fadeIn} y2={gainLineAt(clip.gain)} />
                          {/if}
                          {#if fades.fadeOut > 0}
                            <line x1={at.length} y1="1" x2={at.length - fades.fadeOut} y2={gainLineAt(clip.gain)} />
                          {/if}
                        </svg>
                      {/if}
                      <!-- A dot at each end of the gain line, dragged in to fade in or out, or back to the edge for none. -->
                      {#each ['fadeIn', 'fadeOut'] as const as end (end)}
                        {@const fade = fades[end]}
                        <span
                          class="fade-dot edit-only"
                          class:in={end === 'fadeIn'}
                          class:out={end === 'fadeOut'}
                          style:--at={gainLineAt(clip.gain)}
                          style:--fade={fade / at.length}
                          aria-hidden="true"
                          title={editHint(
                            freeze,
                            fade > 0
                              ? `${fadeName(end)} ${formatFade(fade)}: drag in to lengthen it, or back to the edge to remove it`
                              : `${fadeName(end)}: drag in to add it`,
                          )}
                          onpointerdown={(e) => editDown(e, clip, end)}
                        ></span>
                      {/each}
                      {#if editing && clipDrag.moved && isFadeEnd(clipDrag.mode)}
                        {@const fade = fades[clipDrag.mode]}
                        <span
                          class="gain-tip"
                          class:below={gainLineAt(clip.gain) < 0.5}
                          style:top="{gainLineAt(clip.gain) * 100}%"
                          >{fade > 0 ? `${fadeName(clipDrag.mode)} ${formatFade(fade)}` : 'No fade'}</span
                        >
                      {/if}
                      {#if editing && clipDrag.mode === 'gain' && clipDrag.moved}
                        <!-- Above the line, or below it in the waveform's top half, to stay inside the Clip. -->
                        <span
                          class="gain-tip"
                          class:below={gainLineAt(clip.gain) < 0.5}
                          style:top="{gainLineAt(clip.gain) * 100}%">{formatGain(clip.gain)}</span
                        >
                      {/if}
                    </span>
                    <span
                      class="trim start edit-only"
                      aria-hidden="true"
                      title={editHint(freeze, 'Drag to trim the start')}
                      onpointerdown={(e) => editDown(e, clip, 'start')}
                    ></span>
                    <span
                      class="trim end edit-only"
                      aria-hidden="true"
                      title={editHint(freeze, 'Drag to trim the end')}
                      onpointerdown={(e) => editDown(e, clip, 'end')}
                    ></span>
                  </div>
                {/each}
                {#if capturing && recorder.trackId === track.id && recorder.plan && position > recorder.plan.start}
                  {@const retaken = track.clips.find((c) => c.id === recorder.clipId)}
                  {@const taken = position - recorder.plan.start}
                  {@const length = retaken ? Math.min(taken, retakeLength(retaken, track.clips, position)) : taken}
                  {@const shown = waveWindow(view, recorder.plan.start, length)}
                  <!-- A Retake shows growing over its Clip, and stops at the next Clip, as it will be saved. -->
                  <div
                    class="clip taking"
                    style:left="{percent(recorder.plan.start)}%"
                    style:width="{percent(length)}%"
                    aria-label="Recording from {formatDuration(recorder.plan.start)}"
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
            {#if box}
              {@const at = spanStyle(Math.max(0, Math.min(box.start, box.end)), Math.max(box.start, box.end))}
              <span
                class="box"
                style:left={at.left}
                style:width={at.width}
                style:top="{Math.min(box.top, box.bottom)}px"
                style:height="{Math.abs(box.bottom - box.top)}px"
                aria-hidden="true"
              ></span>
            {/if}
            {#if guide}
              <span
                class="snap-guide"
                style:left="{percent(guide.at)}%"
                style:top="{guide.top}px"
                style:height="{guide.height}px"
                aria-hidden="true"
              ></span>
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

    {#if editing.cueOffer}
      {@const offer = editing.cueOffer}
      <div class="offer" role="status">
        <span
          >{offer.clips === 1 ? 'The Clip' : `The ${offer.clips} Clips`} moved {formatCue(Math.abs(offer.by))}
          {offer.by > 0 ? 'later' : 'earlier'}.</span
        >
        <button type="button" class="button" onclick={() => editing.moveCues()}
          >Move {offer.count}
          {offer.count === 1 ? 'Cue' : 'Cues'} with {offer.clips === 1 ? 'it' : 'them'}</button
        >
        <button type="button" class="button" onclick={() => editing.leaveCues()}>Leave them</button>
      </div>
    {/if}
    {#if recorder.unsaved.length > 0}
      <div class="offer" role="status">
        <span>Recovered {recorder.unsaved.length} unsaved {recorder.unsaved.length === 1 ? 'Take' : 'Takes'}.</span>
        <button
          type="button"
          class="button"
          onclick={keepUnsaved}
          disabled={recorder.recovering || frozen}
          title={frozen
            ? unsavedFrozenHint
            : `Upload ${recorder.unsaved.length === 1 ? 'it' : 'them'} where ${recorder.unsaved.length === 1 ? 'it' : 'they'} would have gone, or after the last Clip on the Track if that spot's taken, or on a new Track if theirs is gone`}
          >Keep</button
        >
        <button
          type="button"
          class="button"
          onclick={discardUnsaved}
          disabled={recorder.recovering || frozen}
          title={frozen ? unsavedFrozenHint : undefined}>Discard</button
        >
      </div>
    {/if}
    {#if editing.mergeNote}
      <div class="offer" role="status">
        <span class="merge-note">{editing.mergeNote}</span>
        <button type="button" class="button" onclick={() => editing.dismissMergeNote()}>OK</button>
      </div>
    {/if}
    {#if offerBpm}
      <div class="offer" role="status">
        <span class="tabular">This Song has no BPM. Use {offerBpm.bpm} BPM from “{offerBpm.title}”?</span>
        <button type="button" class="button tabular" onclick={useBpm}>Use {offerBpm.bpm} BPM</button>
        <button type="button" class="button" onclick={() => (offerBpm = null)}>No thanks</button>
      </div>
    {/if}
  </div>
  {#if shownError}
    <!-- Over the page just above the Timeline, so showing it never moves anything. -->
    <div class="error-bar" role="alert">
      <span class="error">{shownError}</span>
      <button type="button" class="dismiss" onclick={() => showError(null)} aria-label="Dismiss" title="Dismiss"
        ><X /></button
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
{#if mixingDown}
  <!-- Mixed as playback would play it now, which starting it stops. Sync mode stays as it is. -->
  <MixdownDialog
    songTitle={song.title}
    end={mixdownEnd(clips)}
    loop={timeline.loop && { ...timeline.loop, on: loopOn }}
    plan={() => ({ clips: playable, gains: trackGains(timeline.tracks), load: (source) => player.load(source) })}
    onStart={() => transport.stop()}
    onClose={() => (mixingDown = false)}
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
    /* The shared edge, scaled to the room left for it on a Track's header. */
    --selected-edge: inset calc(0.1875 * var(--timeline-rem)) 0 0 var(--accent);
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
    font-size: calc(1.25 * var(--timeline-rem));
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
  /* Play or pause, between going to the start and to the end. */
  .playback {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: calc(0.25 * var(--timeline-rem));
  }
  /* Solid, like play and pause between them. */
  .skip :global(.lucide-icon) {
    fill: currentColor;
  }
  .play {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: var(--touch);
    height: var(--touch);
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-text);
    font-size: calc(1.25 * var(--timeline-rem));
    cursor: pointer;
  }
  /* Solid, to stand out on the accent. */
  .play :global(.lucide-icon) {
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
    /* The grip's strip, and the room each header leaves for it. */
    --grip-width: calc(1.625 * var(--timeline-rem));
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
    /* Its spacing and the buttons' are kept small, so both fit side by side. */
    gap: calc(0.25 * var(--timeline-rem));
    height: calc(2.25 * var(--timeline-rem));
  }
  /* Small enough for the corner, both side by side; the corner can't grow without moving the lanes. */
  .add {
    gap: calc(0.25 * var(--timeline-rem));
    min-height: calc(1.75 * var(--timeline-rem));
    padding: 0 calc(0.5 * var(--timeline-rem));
    font-size: calc(0.875 * var(--timeline-rem));
  }
  .head {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex-shrink: 0;
    gap: calc(0.25 * var(--timeline-rem));
    height: var(--track-height);
    padding-left: calc(0.5 * var(--timeline-rem));
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
    padding-left: var(--grip-width);
  }
  .grip {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    display: grid;
    /* At the top, level with the Track's name, and centred between the
       header's edge and the name, clear of the Chosen Track's line. */
    place-content: start center;
    padding-top: calc(0.5 * var(--timeline-rem));
    width: var(--grip-width);
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
    border-radius: var(--radius-full);
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
    box-shadow: var(--selected-edge);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  /* The Track audio files dragged over the Timeline would be imported onto, across its header and lane. */
  .head.file-target,
  .lane.file-target {
    box-shadow: var(--selected-outline);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
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
    padding: 0 calc(0.25 * var(--timeline-rem));
    border: 1px solid transparent;
    border-radius: calc(0.375 * var(--timeline-rem));
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
  :global(:root:not([data-pointer-focus])) .track-actions button:focus-visible {
    color: var(--accent);
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
    border-radius: calc(0.375 * var(--timeline-rem));
    background: none;
    color: var(--text-muted);
    font-size: calc(0.75 * var(--timeline-rem));
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
  /* Focused by a press on empty lane space, for the Timeline's keys, but not a tab stop. */
  .lanes:focus {
    outline: none;
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
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--text-muted) 60%, transparent);
    outline: 1px solid color-mix(in srgb, var(--bg) 60%, transparent);
    cursor: grab;
    transition:
      top var(--duration-fast) var(--ease),
      bottom var(--duration-fast) var(--ease);
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
    border-radius: 0;
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
  .loop-clear :global(.lucide-icon) {
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
    padding: 0 calc(0.5 * var(--timeline-rem));
  }
  .toggle.loop-toggle:disabled {
    opacity: 0.5;
    cursor: default;
  }
  /* While recording, nothing on the Timeline is edited: its Clips stay as
     they look, but don't take a drag, and the Loop's handles show off. */
  .frozen .head,
  .frozen .clip,
  .frozen .trim {
    cursor: default;
  }
  .frozen .trim:hover {
    background: none;
  }
  .frozen .fade-dot {
    cursor: default;
  }
  .frozen button.name:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .frozen .loop-edge {
    cursor: not-allowed;
  }
  .frozen .loop-edge:hover {
    background: none;
  }
  .loop-clear:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .toggle.record {
    display: inline-flex;
    align-items: center;
    gap: calc(0.25 * var(--timeline-rem));
    width: auto;
    padding: 0 calc(0.5 * var(--timeline-rem));
  }
  /* A dot, solid: a square to stop. */
  .record-dot {
    display: flex;
    color: var(--danger);
    font-size: calc(0.75 * var(--timeline-rem));
  }
  .record-dot :global(.lucide-icon) {
    fill: currentColor;
  }
  .toggle.record[aria-pressed='true'] {
    border-color: var(--danger);
    background: var(--danger);
    color: var(--bg);
  }
  .toggle.record[aria-pressed='true'] .record-dot {
    color: inherit;
  }
  .not-calibrated {
    padding: var(--space-1) var(--space-2);
    border: 1px dashed var(--warning);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--warning);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .not-calibrated:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .input-note,
  .merge-note {
    color: var(--warning);
  }
  .toggle.record:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .transport-more {
    display: inline-flex;
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
    /* A long press draws a box, not the browser's text selection or callout. */
    user-select: none;
    -webkit-touch-callout: none;
  }
  .clip {
    position: absolute;
    top: calc(0.25 * var(--timeline-rem));
    bottom: calc(0.25 * var(--timeline-rem));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--accent);
    border-radius: calc(0.375 * var(--timeline-rem));
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
  /* Selected: ringed inside its border and the focus ring, and a brighter fill. */
  .clip.selected {
    box-shadow: var(--selected-outline);
    background: color-mix(in srgb, var(--accent) 16%, var(--surface-1));
  }
  .clip.moving {
    cursor: grabbing;
    opacity: 0.85;
  }
  .clip.nudging {
    cursor: ew-resize;
  }
  .clip.gaining {
    cursor: ns-resize;
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
    font-size: calc(0.75 * var(--timeline-rem));
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .clip-name {
    flex: 1;
    min-width: 0;
    min-height: 0;
    margin: 1px;
    padding: 0 calc(0.25 * var(--timeline-rem));
    border: 1px solid var(--border);
    border-radius: calc(0.375 * var(--timeline-rem));
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: calc(0.75 * var(--timeline-rem));
    font-weight: 600;
    line-height: 1.25;
    user-select: text;
    cursor: text;
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
  :global(:root:not([data-pointer-focus]) :focus-visible) > .clip-more {
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
  /*
   * A Clip's gain line: a hairline --at of the way down the waveform, in a
   * thin target a few pixels either side of it, clear of the trim edges,
   * which keep their own cursor. The target slides as far down within the
   * waveform as the line does, so at either end it stays inside it, clear
   * of the Clip's head, the line still exactly --at of the way down. It runs
   * between the Fades, which slope down from it to the Clip's edges.
   */
  .gain-line {
    position: absolute;
    left: max(calc(0.375 * var(--timeline-rem)), calc(var(--fade-in) * 100%));
    right: max(calc(0.375 * var(--timeline-rem)), calc(var(--fade-out) * 100%));
    top: calc(var(--at) * (100% - 0.5 * var(--timeline-rem)));
    height: calc(0.5 * var(--timeline-rem));
    cursor: ns-resize;
  }
  .gain-line::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: calc(var(--at) * (100% - 1px));
    height: 1px;
    background: var(--text-muted);
    opacity: 0.35;
  }
  .gain-line.changed::before {
    background: var(--accent);
    opacity: 0.8;
  }
  .gain-line:hover::before,
  .clip.gaining .gain-line::before {
    height: 2px;
    margin-top: -0.5px;
    background: var(--accent);
    opacity: 1;
  }
  /* A Clip's Fades, drawn as straight slopes over its waveform, whatever their curve. */
  .wave svg.fade-slopes {
    left: 0;
    width: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .fade-slopes line {
    stroke: var(--accent);
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
    opacity: 0.8;
  }
  /*
   * A fade dot, at an end of the gain line: --fade of the way in from the
   * Clip's edge, or without a Fade, resting just inside the trim edge. It
   * shows while the Clip is hovered or selected, and the dot itself is
   * drawn small inside a larger target.
   */
  .fade-dot {
    --dot: calc(0.625 * var(--timeline-rem));
    position: absolute;
    top: calc(var(--at) * (100% - 1px));
    width: var(--dot);
    height: var(--dot);
    margin-top: calc(var(--dot) / -2);
    cursor: col-resize;
    opacity: 0;
  }
  .fade-dot.in {
    left: max(calc(0.375 * var(--timeline-rem)), calc(var(--fade) * 100% - var(--dot) / 2));
  }
  .fade-dot.out {
    right: max(calc(0.375 * var(--timeline-rem)), calc(var(--fade) * 100% - var(--dot) / 2));
  }
  .fade-dot::before {
    content: '';
    position: absolute;
    inset: 25%;
    border: 1px solid var(--bg);
    border-radius: var(--radius-full);
    background: var(--accent);
  }
  .fade-dot:hover::before,
  .clip.fading .fade-dot::before {
    inset: 15%;
  }
  .clip:hover .fade-dot,
  .clip.selected .fade-dot,
  .clip.fading .fade-dot {
    opacity: 1;
  }
  .clip.fading {
    cursor: col-resize;
  }
  /* The Gain while its line is dragged, or a Fade while its dot is. */
  .gain-tip {
    position: absolute;
    left: 50%;
    z-index: 1;
    padding: 0 calc(0.25 * var(--timeline-rem));
    border: 1px solid var(--border);
    border-radius: calc(0.375 * var(--timeline-rem));
    background: var(--bg);
    color: var(--text);
    font-size: calc(0.75 * var(--timeline-rem));
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    transform: translate(-50%, -120%);
    pointer-events: none;
  }
  .gain-tip.below {
    transform: translate(-50%, 20%);
  }
  /* A Clip's Gain, when it isn't 0 dB. */
  .clip-gain {
    flex-shrink: 0;
    padding: 0 calc(0.25 * var(--timeline-rem));
    color: var(--text-muted);
    font-size: calc(0.75 * var(--timeline-rem));
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* A peak of a Take that clipped. */
  rect.clipped {
    fill: var(--danger);
    opacity: 1;
  }
  /* The box being drawn over empty lane space, selecting the Clips it touches. */
  .box {
    position: absolute;
    z-index: 2;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    pointer-events: none;
  }
  /* What a moved or trimmed Clip, or the Loop being set, is snapped to, through the lanes aligned there, and up through the ruler for a Loop edge or the Loop. */
  .snap-guide {
    --line-width: round(calc(0.125 * var(--timeline-rem)), 1px);
    position: absolute;
    width: var(--line-width);
    margin-left: round(calc(var(--line-width) / -2), 1px);
    background: var(--accent);
    pointer-events: none;
  }
  .playhead {
    /* In whole pixels, so it stays sharp. */
    --line-width: round(calc(0.125 * var(--timeline-rem)), 1px);
    position: absolute;
    top: 0;
    bottom: 0;
    width: var(--line-width);
    margin-left: round(calc(var(--line-width) / -2), 1px);
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
    padding: calc(0.5 * var(--timeline-rem)) calc(0.75 * var(--timeline-rem));
    border: 1px solid var(--danger);
    border-radius: calc(0.5 * var(--timeline-rem));
    background: var(--bg);
    box-shadow: var(--shadow-float);
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
    font-size: calc(1.25 * var(--timeline-rem));
    cursor: pointer;
  }

  /*
   * On a phone held upright, the Timeline only plays: the transport row
   * alone. The Tracks are hidden much as when collapsed, so they come back as
   * they were on widening the window or turning it sideways, and playback
   * goes on with their saved levels and Loop.
   */
  @media (max-width: 40rem) and ((orientation: portrait) or (height >= 30rem)) {
    /* Already sized for a phone, and there's no room to spare. */
    .timeline {
      --timeline-scale: 1;
    }
    /* Important, so no element's own display, however specific, shows an edit-only one here. */
    .edit-only {
      display: none !important;
    }
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

  /*
   * On a phone held sideways, or any landscape window under 30rem tall, the
   * Timeline is all there is: it fills the window over the Song page and the
   * navigation (app.css), can't be collapsed or resized, and its Tracks take
   * all the height below the transport row, which stays on one line.
   */
  @media (orientation: landscape) and (height < 30rem) {
    /* Already sized for a phone, and there's no room to spare. */
    .timeline {
      --timeline-scale: 1;
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      border-top: none;
    }
    .collapse-toggle {
      display: none;
    }
    /* Clear of a camera cutout or the home indicator, on whichever side. */
    .inner {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      padding-top: max(calc(0.5 * var(--timeline-rem)), env(safe-area-inset-top));
      padding-bottom: max(calc(0.5 * var(--timeline-rem)), env(safe-area-inset-bottom));
    }
    .transport {
      flex-wrap: nowrap;
    }
    .transport > * {
      flex-shrink: 0;
    }
    /* A message gives way first, cut short rather than wrapping, so the
       Tracks keep their height mid-take. */
    .transport > .status {
      flex-shrink: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tracks {
      flex: 1;
      min-height: 0;
    }
  }
</style>
