<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { api, type Beat, type Clip, type Song, type SongAt, type Timeline, type Track, type TrackChanges } from './api';
  import BeatPicker from './BeatPicker.svelte';
  import { clampMove, clampTrimEnd, clampTrimStart } from './clipEdit';
  import { formatVolume, maxVolume, silence, trackGains, type Levels } from './mixer';
  import { peaksPerSecond } from './peaks';
  import { timelineEnd, type Placed } from './schedule';
  import { formatDuration } from './time';
  import { TimelinePlayer, type PlayableClip, type PlayerState } from './timelinePlayer';
  import { bars } from './waveform';

  // The Timeline, docked under the Lyric Sheet: its Tracks and Clips, and
  // playback with each Track's volume, mute and solo. Editing (adding Beats,
  // adding, renaming, reordering and deleting Tracks, moving, trimming,
  // duplicating and deleting Clips) is only offered on wider screens; on a
  // phone it only plays and mixes.
  let {
    song,
    timeline,
    change,
    setBpm,
  }: {
    song: Song;
    timeline: Timeline;
    /** Queues a Timeline change; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Timeline>) => Promise<boolean>;
    /** Sets the Song's BPM. */
    setBpm: (bpm: number) => void;
  } = $props();

  let playerState = $state<PlayerState>('stopped');
  let position = $state(0);
  let error = $state<string | null>(null);
  let collapsed = $state(false);
  let picking = $state(false);
  // A Beat just added whose BPM could become the Song's.
  let offerBpm = $state<{ bpm: number; title: string } | null>(null);
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
  // Room after the last Clip, to drag Clips later on the Timeline.
  const span = $derived(length > 0 ? length + Math.max(10, length / 4) : 0);
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
    await change((at) => api.updateTrack(at, track.id, levelChanges));
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
    if (!name || !(await change((at) => api.updateTrack(at, track.id, { name })))) input.value = track.name;
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
    change((at) => api.reorderTracks(at, order));
  }

  // Deleting a Track doesn't ask first either: its Beats stay in the Beat
  // Library, and undo arrives later.
  function removeTrack(track: Track) {
    change((at) => api.deleteTrack(at, track.id));
  }

  // A change to what plays is heard right away. The Timeline is replaced
  // after every change to it, so compare what would play, not the objects,
  // and in an order reordering Tracks doesn't change.
  const playKey = $derived(JSON.stringify([...playable].sort((a, b) => a.trackId - b.trackId || a.start - b.start)));
  $effect(() => {
    void playKey;
    untrack(() => {
      if (playerState !== 'stopped') play(playable, player.position());
    });
  });

  // Follow the playhead every frame while playing, and stop at the end.
  $effect(() => {
    if (playerState !== 'playing') return;
    let frame = requestAnimationFrame(function follow() {
      if (!dragging) position = player.position();
      if (position >= length) {
        player.stop();
        player.seek(length);
        position = length;
        return;
      }
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  });

  function play(clipsToPlay: PlayableClip[], from: number) {
    error = null;
    player.play(clipsToPlay, from).catch((e: Error) => (error = e.message));
  }

  function toggle() {
    if (playerState !== 'stopped') {
      player.stop();
      position = player.position();
      return;
    }
    // At the end, playing starts over.
    play(playable, position >= length ? 0 : position);
  }

  function seek(to: number) {
    position = Math.max(0, Math.min(length, to));
    if (playerState === 'stopped') player.seek(position);
    else play(playable, position);
  }

  // Clicking on the ruler seeks. Dragging moves the playhead, and while
  // playing, playback only jumps there on release, so it doesn't stutter.
  let dragging = false;

  function timeAt(event: PointerEvent): number {
    return Math.max(0, Math.min(length, spanTimeAt(event.clientX)));
  }

  /** The time under a point across the lanes, which may be past the end. */
  function spanTimeAt(clientX: number): number {
    const box = lanesElement!.getBoundingClientRect();
    return ((clientX - box.left) / box.width) * span;
  }

  function pointerDown(event: PointerEvent) {
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    seek(timeAt(event));
  }

  function pointerMove(event: PointerEvent) {
    if (!dragging) return;
    if (playerState === 'stopped') seek(timeAt(event));
    else position = timeAt(event);
  }

  function pointerUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    seek(timeAt(event));
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
    seek(to);
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

  async function addBeat(beat: Beat) {
    picking = false;
    const ok = await change((at) => api.addBeatToTimeline(at, beat.id));
    // Never copied without asking.
    if (ok && song.bpm === null && beat.bpm !== null) offerBpm = { bpm: beat.bpm, title: beat.title };
  }

  function useBpm() {
    if (offerBpm) setBpm(offerBpm.bpm);
    offerBpm = null;
  }

  function addTrack() {
    change((at) => api.addTrack(at, `Track ${timeline.tracks.length + 1}`));
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

  function editDown(event: PointerEvent, clip: Clip, mode: Edit['mode']) {
    if (!editable.current || event.button !== 0 || edit) return;
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

  function editMove(event: PointerEvent) {
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
    await change((at) =>
      mode === 'move' ? api.moveClip(at, clip.id, trackId, to.start) : api.trimClip(at, clip.id, to.offset, to.length),
    );
    edit = null;
  }

  function editCancel() {
    stopListening();
    if (!edit?.saving) edit = null;
  }

  function stopListening() {
    window.removeEventListener('pointermove', editMove);
    window.removeEventListener('pointerup', editUp);
    window.removeEventListener('pointercancel', editCancel);
  }
  onDestroy(stopListening);

  function duplicate(clip: Clip) {
    change((at) => api.duplicateClip(at, clip.id));
  }

  // Deleting doesn't ask first: no file is lost, and the Beat stays in the
  // Beat Library to add again.
  function remove(clip: Clip) {
    change((at) => api.deleteClip(at, clip.id));
  }

  function clipKey(event: KeyboardEvent, clip: Clip) {
    if (event.target !== event.currentTarget || !editable.current) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(clip);
    }
  }

  // Ruler marks at a round interval, about one every 1/8 of the Timeline.
  const tickStep = $derived([1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => span / s <= 8) ?? 1200);
  const ticks = $derived(
    Array.from({ length: Math.floor(span / tickStep) + 1 }, (_, i) => i * tickStep).filter((t) => t < span),
  );

  /** Where a time falls across the Timeline's width, in percent. */
  function percent(time: number): number {
    return span > 0 ? (time / span) * 100 : 0;
  }

  /** The Clip's stretch of its Beat's waveform, as count bars. */
  function clipShape(beatId: number, offset: number, clipLength: number, count: number): number[] {
    const all = peaks[beatId] ?? [];
    return bars(all.slice(Math.floor(offset * peaksPerSecond), Math.ceil((offset + clipLength) * peaksPerSecond)), count);
  }
</script>

<svelte:window onkeydown={spaceBar} />

<section class="timeline" aria-label="Timeline">
  <div class="inner">
    {#if empty}
      <div class="empty">
        <span class="muted">No beat on the Timeline yet.</span>
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
        {#if playerState === 'loading'}
          <span class="muted" role="status">Loading audio…</span>
        {/if}
        <span class="spacer"></span>
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

      <div class="tracks" id="timeline-tracks" hidden={collapsed}>
        <div class="heads">
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
        <div class="lanes" bind:this={lanesElement}>
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
            onpointercancel={() => (dragging = false)}
            onkeydown={rulerKey}
          >
            {#each ticks as t (t)}
              <span class="tick" style:left="{percent(t)}%">{formatDuration(t)}</span>
            {/each}
          </div>
          {#each shown as { track, clips: placed }, t (track.id)}
            <div class="lane" bind:this={laneElements[t]}>
              {#each placed as { clip, at, editing } (clip.id)}
                {@const count = Math.max(4, Math.round((at.length / span) * 400))}
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
                  <svg viewBox="0 0 {count} 100" preserveAspectRatio="none" aria-hidden="true">
                    {#each clipShape(clip.beatId, at.offset, at.length, count) as peak, i (i)}
                      {@const height = Math.max(2, peak * 100)}
                      <rect x={i + 0.15} y={(100 - height) / 2} width="0.7" {height} />
                    {/each}
                  </svg>
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
          <span class="playhead" style:left="{percent(position)}%" aria-hidden="true"></span>
        </div>
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
    position: sticky;
    bottom: 0;
    z-index: 1;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  .inner {
    max-width: 72rem;
    margin: 0 auto;
    padding: 0.5rem max(1rem, env(safe-area-inset-right)) max(0.5rem, env(safe-area-inset-bottom))
      max(1rem, env(safe-area-inset-left));
  }
  .empty,
  .transport,
  .offer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }
  .empty {
    justify-content: space-between;
  }
  .spacer {
    flex: 1;
  }
  .play {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 2.75rem;
    height: 2.75rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
    cursor: pointer;
  }
  .play svg {
    width: 1.25rem;
    height: 1.25rem;
    fill: currentColor;
  }
  .time {
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }
  .tracks {
    display: flex;
    max-height: 40vh;
    margin-top: 0.5rem;
    overflow-y: auto;
  }
  .tracks[hidden] {
    display: none;
  }
  .heads {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    width: 11rem;
    padding-right: 0.5rem;
  }
  .ruler-gap,
  .ruler {
    height: 1.5rem;
    flex-shrink: 0;
  }
  .head {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.25rem;
    height: 3.5rem;
    border-bottom: 1px solid var(--border);
  }
  .head-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    padding: 0 0.125rem;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 0.8125rem;
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
    padding: 0 0.25rem;
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 0.75rem;
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
    width: 1.5rem;
    height: 1.25rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    background: none;
    color: var(--text-muted);
    font-size: 0.6875rem;
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
    accent-color: var(--accent);
  }
  .lanes {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .ruler {
    position: relative;
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
    padding-left: 0.25rem;
    border-left: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .lane {
    position: relative;
    height: 3.5rem;
    border-bottom: 1px solid var(--border);
  }
  .clip {
    position: absolute;
    top: 0.25rem;
    bottom: 0.25rem;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--accent);
    border-radius: 0.25rem;
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
    padding: 0 0.25rem;
    font-size: 0.6875rem;
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
    padding: 0 0.25rem;
    border: none;
    background: none;
    color: var(--text);
    font-size: 0.75rem;
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
    width: 0.375rem;
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
  .clip svg {
    flex: 1;
    min-height: 0;
    width: 100%;
  }
  rect {
    fill: var(--accent);
    opacity: 0.7;
  }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--text);
    pointer-events: none;
  }
  .offer {
    margin-top: 0.5rem;
    font-size: 0.875rem;
  }
  .error {
    margin-top: 0.5rem;
  }

  /* On a phone, the Timeline only plays. */
  @media (max-width: 40rem) {
    .edit-only {
      display: none;
    }
    .heads {
      width: 8rem;
    }
    /* Easier to hit with a thumb. */
    .toggle {
      width: 1.75rem;
      height: 1.5rem;
    }
    /* .clip-actions shows on hover, so it needs hiding here too. */
    .clip .clip-actions {
      display: none;
    }
  }
</style>
