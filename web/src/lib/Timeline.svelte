<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { api, type Beat, type Song, type SongAt, type Timeline } from './api';
  import BeatPicker from './BeatPicker.svelte';
  import { peaksPerSecond } from './peaks';
  import { timelineEnd } from './schedule';
  import { formatDuration } from './time';
  import { TimelinePlayer, type PlayableClip, type PlayerState } from './timelinePlayer';
  import { bars } from './waveform';

  // The Timeline, docked under the Lyric Sheet: its Tracks and Clips, and
  // playback. Adding a Beat is only offered on wider screens; on a phone it
  // only plays.
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
    clips.map((c) => ({ ...c, source: api.beatAudioUrl(beats.get(c.beatId)!) })),
  );
  const length = $derived(timelineEnd(clips));
  const empty = $derived(clips.length === 0);

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

  // A change to what plays is heard right away. The Timeline is replaced
  // after every change to it, so compare what would play, not the objects.
  const playKey = $derived(JSON.stringify(playable));
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
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.max(0, Math.min(length, ((event.clientX - box.left) / box.width) * length));
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

  // Ruler marks at a round interval, about one every 1/8 of the Timeline.
  const tickStep = $derived([1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => length / s <= 8) ?? 1200);
  const ticks = $derived(
    Array.from({ length: Math.floor(length / tickStep) + 1 }, (_, i) => i * tickStep).filter((t) => t < length),
  );

  /** Where a time falls across the Timeline's width, in percent. */
  function percent(time: number): number {
    return length > 0 ? (time / length) * 100 : 0;
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
        <div class="names">
          <span class="ruler-gap"></span>
          {#each timeline.tracks as track (track.id)}
            <span class="name">{track.name}</span>
          {/each}
        </div>
        <div class="lanes">
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
          {#each timeline.tracks as track (track.id)}
            <div class="lane">
              {#each track.clips as clip (clip.id)}
                {@const count = Math.max(4, Math.round((clip.length / length) * 400))}
                <div
                  class="clip"
                  style:left="{percent(clip.start)}%"
                  style:width="{percent(clip.length)}%"
                  title={beats.get(clip.beatId)?.title}
                >
                  <span class="clip-title">{beats.get(clip.beatId)?.title}</span>
                  <svg viewBox="0 0 {count} 100" preserveAspectRatio="none" aria-hidden="true">
                    {#each clipShape(clip.beatId, clip.offset, clip.length, count) as peak, i (i)}
                      {@const height = Math.max(2, peak * 100)}
                      <rect x={i + 0.15} y={(100 - height) / 2} width="0.7" {height} />
                    {/each}
                  </svg>
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
  .names {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    width: 6rem;
    padding-right: 0.5rem;
  }
  .ruler-gap,
  .ruler {
    height: 1.5rem;
    flex-shrink: 0;
  }
  .name {
    display: flex;
    align-items: center;
    height: 3.5rem;
    font-size: 0.8125rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .clip-title {
    padding: 0 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    .names {
      width: 4rem;
    }
  }
</style>
