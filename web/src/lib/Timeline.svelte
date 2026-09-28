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
  import BeatPicker from './BeatPicker.svelte';
  import { clampMove, clampTrimEnd, clampTrimStart } from './clipEdit';
  import { cuesInSpan, formatCue } from './cues';
  import {
    History,
    restorable,
    sendEdit,
    type Edit as TimelineEdit,
    type HistoryEdit,
    type Saved,
  } from './history';
  import { formatVolume, maxVolume, silence, trackGains, type Levels } from './mixer';
  import { peaksPerSecond } from './peaks';
  import { keptInLoop, outsideLoop, repeats, timelineEnd, type Loop, type Placed } from './schedule';
  import { inTextField } from './textField';
  import { formatDuration } from './time';
  import { clampHeight, defaultHeight, deviceStorage, heightBounds, readHeight, storeHeight } from './timelineHeight';
  import { TimelinePlayer, type PlayableClip, type PlayerState } from './timelinePlayer';
  import {
    edgeSpeed,
    fitScale,
    follow,
    scrollThumb,
    thumbScroll,
    ticks as rulerTicks,
    timeAt as viewTimeAt,
    view as timelineView,
    waveWindow,
    zoom,
    type View,
  } from './timelineView';
  import { barWidth, bars } from './waveform';

  // The Timeline, docked under the Lyric Sheet: its Tracks and Clips, and
  // playback with each Track's volume, mute and solo, and the Loop. Editing
  // (adding Beats, adding, renaming, reordering and deleting Tracks, moving,
  // trimming, duplicating and deleting Clips, setting and clearing the Loop,
  // and undoing and redoing all of it along with mixing and Cue edits) is
  // only offered on wider screens; on a phone it only plays, mixes and
  // switches the Loop on and off. On both it zooms and scrolls, and follows
  // the playhead while playing. While the Loop is on, the playhead stays
  // inside it.
  let {
    song,
    timeline,
    change,
    setBpm,
    onPlayhead,
    onLoop,
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
  // Peaks by Beat id, fetched once each, so waveforms show before the audio
  // is decoded.
  let peaks = $state<Record<number, number[]>>({});

  const player = new TimelinePlayer((s) => {
    playerState = s;
    // Also when something else playing stopped it.
    if (s === 'stopped') position = player.position();
  });
  onDestroy(() => player.dispose());

  const beats = $derived(new Map(timeline.beats.map((b) => [b.id, b])));
  const clips = $derived(timeline.tracks.flatMap((t) => t.clips));
  const playable = $derived<PlayableClip[]>(
    timeline.tracks.flatMap((t) =>
      t.clips.map((c) => ({ ...c, source: api.beatAudioUrl(beats.get(c.beatId)!), trackId: t.id })),
    ),
  );
  const length = $derived(timelineEnd(clips));
  // Room after the last Clip, or the Loop if it ends later, to drag Clips
  // and the Loop later on the Timeline.
  const reach = $derived(length > 0 ? Math.max(length, timeline.loop?.end ?? 0) : 0);
  const span = $derived(reach > 0 ? reach + Math.max(10, reach / 4) : 0);
  // Seeking outside the Loop switches it off, and until that's saved,
  // playback already goes on without it.
  let switchingOff = $state(false);
  const loopOn = $derived((timeline.loop?.on ?? false) && !switchingOff);
  // The Loop playback repeats: the saved one, while it's on.
  const playingLoop = $derived<Loop | null>(
    loopOn ? { start: timeline.loop!.start, end: timeline.loop!.end } : null,
  );
  const empty = $derived(clips.length === 0);
  // Matches the phone layout below, which hides editing.
  const editable = new MediaQuery('min-width: 40.0625rem');

  // Decode in the background, so playing can start right away.
  $effect(() => {
    for (const c of playable) player.load(c.source).catch(() => {});
  });

  $effect(() => {
    for (const b of timeline.beats) {
      if (untrack(() => b.id in peaks)) continue;
      peaks[b.id] = [];
      api.getBeat(b.id).then(
        (full) => (peaks[b.id] = full.peaks ?? []),
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
  async function send(
    at: SongAt,
    e: HistoryEdit,
    note: (before: Timeline, after: Timeline) => void,
  ): Promise<Saved> {
    if (e.kind === 'restoreCues') {
      // Cues whose Line or Occurrence is gone since can't come back. With
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

  /** Queues an edit, to undo later; resolves to whether it succeeded. */
  function perform(e: TimelineEdit): Promise<boolean> {
    e = $state.snapshot(e) as TimelineEdit;
    offerCues = null;
    queued++;
    return change((at) => send(at, e, (before, after) => history.record(e, before, after))).finally(() => queued--);
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
    if (event.defaultPrevented || !editable.current || picking || inTextField(event.target)) return;
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }

  function keydown(event: KeyboardEvent) {
    spaceBar(event);
    undoKeys(event);
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

  async function rename(track: Track, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const name = input.value.trim();
    if (name === track.name) {
      input.value = name;
      return;
    }
    // A Track needs a name, so a blank one goes back to what it was.
    if (!name || !(await perform({ kind: 'updateTrack', trackId: track.id, changes: { name } }))) input.value = track.name;
  }

  function nameKey(track: Track, event: KeyboardEvent) {
    const input = event.currentTarget as HTMLInputElement;
    if (event.key === 'Enter') input.blur();
    else if (event.key === 'Escape') {
      input.value = track.name;
      input.blur();
    }
  }

  /** Moves a Track up or down by one, with its Clips. */
  function shift(index: number, by: -1 | 1) {
    const order = timeline.tracks.map((t) => t.id);
    [order[index], order[index + by]] = [order[index + by], order[index]];
    perform({ kind: 'reorderTracks', order });
  }

  // Deleting a Track doesn't ask first either: it can be undone.
  function removeTrack(track: Track) {
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
      const from = playerState === 'stopped' ? position : player.position();
      const to = keptInLoop(from, playingLoop);
      if (playerState !== 'stopped') play(to);
      else if (to !== from) seek(to);
    });
  });

  // Follow the playhead every frame while playing, and stop at the end,
  // unless going round the Loop.
  $effect(() => {
    // Only stopping lets go of the playhead: starting over from elsewhere
    // (e.g. after an edit) loads for a moment, and keeps it.
    if (playerState === 'stopped') untrack(() => onPlayhead?.(null));
    if (playerState !== 'playing') return;
    let frame = requestAnimationFrame(function step() {
      if (!dragging) position = player.position();
      onPlayhead?.(position);
      if (position >= length && !player.repeating) {
        player.stop();
        player.seek(length);
        position = length;
        return;
      }
      // Not while something's dragged, which would jump with the page.
      if (following && !dragging && !edit && !loopEdit) reveal(position);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  });

  function play(from: number) {
    error = null;
    player.play(playable, from, playingLoop).catch((e: Error) => (error = e.message));
  }

  function toggle() {
    if (playerState !== 'stopped') {
      player.stop();
      position = player.position();
      return;
    }
    following = true;
    // At the end, playing starts over, unless there's a Loop yet to go round.
    play(position >= length && !repeats(position, playingLoop) ? 0 : position);
  }

  /** A time on the Timeline, kept between its start and end. */
  function clamp(t: number): number {
    return Math.max(0, Math.min(length, t));
  }

  function seek(to: number) {
    position = clamp(to);
    if (playerState === 'stopped') player.seek(position);
    else play(position);
  }

  /** Seeks where asked by hand, switching the Loop off if that's outside it. */
  function seekByHand(to: number) {
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

  /** Where a pointer is on the page. */
  type Point = Pick<PointerEvent, 'clientX' | 'clientY'>;

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

  /** Seeks as asked by hand, bringing the playhead into view, e.g. for a cued Line. */
  export function seekTo(to: number) {
    following = true;
    seekByHand(to);
    reveal(position);
  }

  /**
   * Whether a space pressed there is its own: typed into a text field, or
   * pressing a focused button or checkbox, rather than playing or pausing.
   */
  function ownsSpace(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || target.closest('input, textarea, select, button, a[href], summary, label') !== null;
  }

  function spaceBar(event: KeyboardEvent) {
    if (event.key !== ' ' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.defaultPrevented || empty || picking || ownsSpace(event.target)) return;
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

  async function addBeat(beat: Beat) {
    picking = false;
    const ok = await perform({ kind: 'addBeat', beatId: beat.id });
    // Never copied without asking.
    if (ok && song.bpm === null && beat.bpm !== null) offerBpm = { bpm: beat.bpm, title: beat.title };
  }

  function useBpm() {
    if (offerBpm) setBpm(offerBpm.bpm);
    offerBpm = null;
  }

  function addTrack() {
    perform({ kind: 'addTrack', track: { name: `Track ${timeline.tracks.length + 1}` } });
  }

  // Editing a Clip: dragging its body moves it, along its Track or onto
  // another; dragging an edge trims it. It stops at its neighbours, the
  // source's ends and 0:00 as it goes, and is saved on release. Until the
  // saved Timeline comes back, the Clip is shown where it was dropped.
  interface Edit {
    clip: Clip;
    mode: 'move' | 'start' | 'end';
    /** Where the pointer went down, to tell a click from a drag. */
    fromX: number;
    /** How far into the Clip it was grabbed, in seconds. */
    grab: number;
    moved: boolean;
    /** Where the Clip is shown now. */
    trackId: number;
    placement: Placed;
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
      if (edit?.trackId === track.id) placed.push({ clip: edit.clip, at: edit.placement, editing: true });
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
  // default, which follows the window.
  let chosenHeight = $state<number | null>(readHeight(deviceStorage()));
  let headsHeight = $state(0);
  let lanesHeight = $state(0);
  let resizing: { y: number; height: number } | null = null;

  const bounds = $derived.by(() => {
    // One Track and the ruler above it.
    const first = laneElements[0];
    const least = first ? first.offsetTop + first.offsetHeight : 0;
    return heightBounds(innerHeight.current ?? 0, least, Math.max(headsHeight, lanesHeight));
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
    if (!editable.current || !event.isPrimary || event.button !== 0 || edit) return;
    event.stopPropagation();
    // Clicking a Clip still focuses it, for its keys and buttons.
    (event.currentTarget as HTMLElement).closest<HTMLElement>('.clip')?.focus();
    event.preventDefault();
    edit = {
      clip,
      mode,
      fromX: event.clientX,
      grab: spanTimeAt(event.clientX) - clip.start,
      moved: false,
      trackId: trackOf(clip).id,
      placement: clip,
      saving: false,
    };
    window.addEventListener('pointermove', editMove);
    window.addEventListener('pointerup', editUp);
    window.addEventListener('pointercancel', editCancel);
  }

  function editMove(event: Point) {
    if (!edit || edit.saving) return;
    // A small wobble while clicking isn't a drag.
    if (!edit.moved && Math.abs(event.clientX - edit.fromX) < 4) return;
    edit.moved = true;
    const t = spanTimeAt(event.clientX);
    const { clip } = edit;
    if (edit.mode === 'move') {
      edit.trackId = trackAt(event.clientY);
      const start = clampMove(othersOn(edit.trackId, clip), clip.length, t - edit.grab);
      edit.placement = { ...clip, start };
    } else if (edit.mode === 'start') {
      edit.placement = clampTrimStart(clip, othersOn(edit.trackId, clip), t);
    } else {
      edit.placement = clampTrimEnd(clip, othersOn(edit.trackId, clip), beats.get(clip.beatId)!.duration, t);
    }
    dragAt(event, editMove);
  }

  async function editUp() {
    stopListening();
    if (!edit) return;
    const { clip, trackId, placement: to, mode } = edit;
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
    if (event.target !== event.currentTarget || !editable.current) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(clip);
    }
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
   * A stretch of a Beat's waveform, from offset seconds in, as count bars
   * over drawn seconds. Past heard seconds in, trimmed off the Clip, it's
   * silent.
   */
  function clipShape(beatId: number, offset: number, heard: number, drawn: number, count: number): number[] {
    const all = peaks[beatId] ?? [];
    const from = Math.floor(offset * peaksPerSecond);
    const kept = all.slice(from, Math.ceil((offset + heard) * peaksPerSecond));
    const silent = Math.max(0, Math.ceil((offset + drawn) * peaksPerSecond) - from - kept.length);
    return bars([...kept, ...new Array<number>(silent).fill(0)], count);
  }
</script>

<svelte:window onkeydown={keydown} />

{#snippet undoRedo()}
  <span class="history edit-only">
    <button type="button" class="icon" onclick={undo} disabled={!undoable} aria-label="Undo" title="Undo (Ctrl+Z)"
      >↶</button
    >
    <button
      type="button"
      class="icon"
      onclick={redo}
      disabled={!redoable}
      aria-label="Redo"
      title="Redo (Ctrl+Shift+Z)">↷</button
    >
  </span>
{/snippet}

<section class="timeline" aria-label="Timeline">
  {#if !empty && !collapsed}
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
    {#if empty}
      <div class="empty">
        <span class="muted">No beat on the Timeline yet.</span>
        <span class="spacer"></span>
        {#if undoable || redoable}{@render undoRedo()}{/if}
        <button type="button" class="button edit-only" onclick={() => (picking = true)}>Add a beat</button>
      </div>
    {:else}
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
        {#if playerState === 'loading'}
          <span class="muted" role="status">Loading audio…</span>
        {/if}
        <span class="spacer"></span>
        {@render undoRedo()}
        <button type="button" class="button edit-only" onclick={() => (picking = true)}>Add a beat</button>
        <button type="button" class="button edit-only" onclick={addTrack}>Add a track</button>
        <button
          type="button"
          class="icon"
          onclick={() => (collapsed = !collapsed)}
          aria-expanded={!collapsed}
          aria-controls="timeline-tracks"
          aria-label={collapsed ? 'Show the Timeline' : 'Hide the Timeline'}
        >
          {collapsed ? '▴' : '▾'}
        </button>
      </div>

      <div class="tracks" id="timeline-tracks" hidden={collapsed} style:max-height="{tracksHeight}px">
        <div class="heads" bind:offsetHeight={headsHeight}>
          <span class="ruler-gap"></span>
          {#each timeline.tracks as track, i (track.id)}
            {@const trackLevels = levels[i]}
            <div class="head" role="group" aria-label="Track {track.name}">
              <div class="head-row">
                {#if editable.current}
                  <input
                    class="name"
                    value={track.name}
                    aria-label="Name of Track {track.name}"
                    onchange={(e) => rename(track, e)}
                    onkeydown={(e) => nameKey(track, e)}
                  />
                  <span class="track-actions">
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
                      aria-label="Delete {track.name} and its Clips"
                      title="Delete the Track and its Clips">×</button
                    >
                  </span>
                {:else}
                  <span class="name">{track.name}</span>
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
                    <span class="loop-edge start edit-only" data-edge="start" title="Drag to move the Loop's start"></span>
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
                aria-valuemax={Math.round(length)}
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
                <div class="lane" bind:this={laneElements[t]}>
                  {#each placed as { clip, at, editing } (clip.id)}
                    {@const wave = waveWindow(view, at.start, at.length)}
                    {@const title = beats.get(clip.beatId)?.title}
                    <!-- Focusable for its Delete key; pointer dragging has no key equivalent yet, and its actions are buttons. -->
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
                    <div
                      class="clip"
                      class:editing
                      class:moving={editing && edit?.mode === 'move'}
                      style:left="{percent(at.start)}%"
                      style:width="{percent(at.length)}%"
                      title={title}
                      role="group"
                      aria-label="{title}, {formatDuration(at.start)} to {formatDuration(at.start + at.length)}"
                      tabindex={editable.current ? 0 : undefined}
                      onpointerdown={(e) => editDown(e, clip, 'move')}
                      onkeydown={(e) => clipKey(e, clip)}
                    >
                      <span class="clip-head">
                        <span class="clip-title">{title}</span>
                        <span class="clip-actions edit-only">
                          <button
                            type="button"
                            onpointerdown={(e) => e.stopPropagation()}
                            onclick={() => duplicate(clip)}
                            aria-label="Duplicate {title}"
                            title="Duplicate">⧉</button
                          >
                          <button
                            type="button"
                            onpointerdown={(e) => e.stopPropagation()}
                            onclick={() => remove(clip)}
                            aria-label="Delete {title}"
                            title="Delete (Del)">×</button
                          >
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
                            {#each clipShape(clip.beatId, at.offset + wave.from, wave.to - wave.from, (wave.bars * barWidth) / view.scale, wave.bars) as peak, i (i)}
                              {@const height = Math.max(2, peak * 100)}
                              <rect x={i + 0.15} y={(100 - height) / 2} width="0.7" {height} />
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
            <div
              class="scrollbar"
              bind:this={barElement}
              onpointerdown={barDown}
              onwheel={barWheel}
              aria-hidden="true"
            >
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
    {/if}

    {#if offerCues}
      <div class="offer" role="status">
        <span>The Clip moved {formatCue(Math.abs(offerCues.by))} {offerCues.by > 0 ? 'later' : 'earlier'}.</span>
        <button type="button" class="button" onclick={moveCues}
          >Move {offerCues.count} {offerCues.count === 1 ? 'Cue' : 'Cues'} with it</button
        >
        <button type="button" class="button" onclick={() => (offerCues = null)}>Leave them</button>
      </div>
    {/if}
    {#if offerBpm}
      <div class="offer" role="status">
        <span>This Song has no BPM. Use {offerBpm.bpm} BPM from “{offerBpm.title}”?</span>
        <button type="button" class="button" onclick={useBpm}>Use {offerBpm.bpm} BPM</button>
        <button type="button" class="button" onclick={() => (offerBpm = null)}>No thanks</button>
      </div>
    {/if}
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}
  </div>
</section>

{#if picking}
  <BeatPicker onPick={addBeat} onClose={() => (picking = false)} />
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
    position: sticky;
    bottom: 0;
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
  /* Docked directly above the tab bar, which keeps clear of the home
     indicator itself. */
  @media (max-width: 65.4375rem) {
    .timeline {
      bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom));
    }
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
  .empty,
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
  /* Beside the loop bar and the ruler. */
  .ruler-gap {
    height: calc(2.25 * var(--timeline-rem));
  }
  .head {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex-shrink: 0;
    gap: calc(0.25 * var(--timeline-rem));
    height: var(--track-height);
    border-bottom: 1px solid var(--border);
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
  input.name:hover,
  input.name:focus {
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
  /* Not on touch screens, where a tap leaves it hovered. */
  @media (hover: hover) {
    .scrollbar:hover .scroll-thumb {
      top: calc(0.0625 * var(--timeline-rem));
      bottom: calc(0.0625 * var(--timeline-rem));
      background: var(--text-muted);
    }
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
  .ruler {
    position: relative;
    /* A label near the end would stick out past the lanes, giving them a
       horizontal scrollbar that pushes the Tracks area into scrolling, whose
       scrollbar narrows the lanes and moves the ticks: an endless flicker. */
    overflow: hidden;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    touch-action: none;
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
  .clip:hover .clip-actions,
  .clip:focus-within .clip-actions {
    display: flex;
  }
  .clip-actions button {
    padding: 0 calc(0.25 * var(--timeline-rem));
    border: none;
    background: none;
    color: var(--text);
    font-size: calc(0.75 * var(--timeline-rem));
    line-height: 1.25;
    cursor: pointer;
  }
  .clip-actions button:hover,
  .clip-actions button:focus-visible {
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
  .error {
    margin-top: calc(0.5 * var(--timeline-rem));
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
    /* Easier to hit with a thumb. */
    .toggle.loop-toggle {
      height: calc(1.5 * var(--timeline-rem));
    }
  }
</style>
