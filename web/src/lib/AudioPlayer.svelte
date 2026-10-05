<script lang="ts">
  import { playMediaAlone } from './playback';
  import PlayerVolume from './PlayerVolume.svelte';
  import { canSetVolume, playerVolume } from './sharedVolume.svelte';
  import { formatDuration } from './time';
  import { gain } from './volume';
  import { bars } from './waveform';

  // A player for a Master or a Beat preview: its waveform, which seeks when
  // clicked, play/pause and, unless hidden, the volume every such player
  // shares. The audio streams through an <audio> element, fetching only the
  // parts played.
  let {
    src,
    duration,
    peaks,
    playing = $bindable(false),
    showVolume = true,
    playOffHint = null,
  }: {
    src: string;
    /** In seconds. */
    duration: number;
    /** The waveform; flat while empty, and the audio still plays. */
    peaks: number[];
    /** Whether the audio is playing, e.g. for a button elsewhere that shows it. */
    playing?: boolean;
    /** Off where the shared volume shows beside the player instead. */
    showVolume?: boolean;
    /** Why it can't play now, e.g. while recording: its play button is off, and says this. */
    playOffHint?: string | null;
  } = $props();

  const barCount = 160;
  // Names this player's clip paths apart from any other player's on the page.
  const uid = $props.id();
  const playedArea = `played-${uid}`;
  const unplayedArea = `unplayed-${uid}`;

  let audio = $state<HTMLAudioElement>();
  let time = $state(0);

  const volume = $derived(playerVolume.value);
  const slider = canSetVolume();

  $effect(() => {
    if (!audio) return;
    audio.muted = volume.muted;
    if (slider) audio.volume = gain(volume.level);
  });

  const shape = $derived(bars(peaks, barCount));
  const played = $derived(duration > 0 ? Math.min(1, time / duration) : 0);

  // timeupdate fires only a few times a second: follow the audio every frame
  // while it plays, so the waveform fills smoothly.
  $effect(() => {
    if (!playing || !audio) return;
    const player = audio;
    let frame = requestAnimationFrame(function follow() {
      time = player.currentTime;
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  });

  // A new file starts from its beginning.
  $effect(() => {
    void src;
    time = 0;
  });

  export function play() {
    audio?.play().catch(() => (playing = false));
  }

  export function toggle() {
    if (!audio) return;
    if (audio.paused) play();
    else audio.pause();
  }

  function seek(to: number) {
    if (!audio) return;
    time = Math.max(0, Math.min(duration, to));
    audio.currentTime = time;
  }

  // Pointer seeking follows a drag across the waveform.
  let dragging = false;

  function seekAt(event: PointerEvent) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    seek(((event.clientX - box.left) / box.width) * duration);
  }

  function pointerDown(event: PointerEvent) {
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    seekAt(event);
  }

  function pointerMove(event: PointerEvent) {
    if (dragging) seekAt(event);
  }

  function keydown(event: KeyboardEvent) {
    const step = event.shiftKey ? 15 : 5;
    const to = {
      ArrowLeft: time - step,
      ArrowDown: time - step,
      ArrowRight: time + step,
      ArrowUp: time + step,
      Home: 0,
      End: duration,
    }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    seek(to);
  }
</script>

<div class="player">
  <div class="controls" class:without-volume={!showVolume}>
    <audio
      bind:this={audio}
      {src}
      preload="none"
      onplay={(e) => {
        playMediaAlone(e);
        playing = true;
      }}
      onpause={() => (playing = false)}
      onended={() => (playing = false)}
      ontimeupdate={() => audio && (time = audio.currentTime)}
    ></audio>

    <button
      type="button"
      class="play"
      onclick={toggle}
      disabled={playOffHint !== null}
      title={playOffHint ?? undefined}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      {#if playing}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
      {/if}
    </button>

    <span class="elapsed time muted">{formatDuration(time)}</span>

    <div
      class="wave"
      role="slider"
      tabindex="0"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext="{formatDuration(time)} of {formatDuration(duration)}"
      onpointerdown={pointerDown}
      onpointermove={pointerMove}
      onpointerup={() => (dragging = false)}
      onpointercancel={() => (dragging = false)}
      onkeydown={keydown}
    >
      <!-- The bars are drawn twice, each copy clipped to its side of the played
           width, so the played colour fills smoothly, partway through a bar. -->
      {#snippet waveBars()}
        {#each shape as peak, i (i)}
          {@const height = Math.max(2, peak * 100)}
          <rect x={i + 0.15} y={(100 - height) / 2} width="0.7" {height} />
        {/each}
      {/snippet}
      <svg viewBox="0 0 {barCount} 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id={playedArea}>
            <rect width={played * barCount} height="100" />
          </clipPath>
          <clipPath id={unplayedArea}>
            <rect x={played * barCount} width={(1 - played) * barCount} height="100" />
          </clipPath>
        </defs>
        <g clip-path="url(#{unplayedArea})">{@render waveBars()}</g>
        <g class="played" clip-path="url(#{playedArea})">{@render waveBars()}</g>
      </svg>
    </div>

    <!-- In one row, the times sit either side of the waveform; wrapped, they
         share one readout under it. -->
    <span class="total time muted">{formatDuration(duration)}</span>
    <span class="both time muted">{formatDuration(time)} / {formatDuration(duration)}</span>

    {#if showVolume}
      <div class="volume"><PlayerVolume /></div>
    {/if}
  </div>
</div>

<style>
  /* The layout follows the player's own width, wherever it is placed. As a
     container it takes that width from its parent, not from its contents. */
  .player {
    container-type: inline-size;
  }
  /* In one row, play, the times and the waveform form one group, centred once
     the waveform reaches its widest (about 5px a bar). Both times reserve room
     for "00:00" and hug the waveform, so it doesn't shift as they count: 5ch
     at this size leaves room to spare at the times' smaller size. The Beat
     preview bar's player column is sized to fit this group at its widest. */
  .controls {
    display: grid;
    grid-template-columns: auto 5ch minmax(0, 48rem) 5ch auto;
    grid-template-areas: 'play elapsed wave total volume';
    justify-content: center;
    align-items: center;
    gap: var(--space-3);
  }
  /* Without the volume, no empty column takes the group off centre. */
  .controls.without-volume {
    grid-template-columns: auto 5ch minmax(0, 48rem) 5ch;
    grid-template-areas: 'play elapsed wave total';
  }
  .elapsed {
    grid-area: elapsed;
    text-align: right;
  }
  .total {
    grid-area: total;
  }
  .both {
    display: none;
  }
  /* Narrow, the waveform takes the whole top row after play. Under it, the time
     starts at its left edge and the volume sits at the right. The volume slider
     shows either way: wrapped, it no longer takes width from the waveform. */
  @container (max-width: 32rem) {
    .controls,
    .controls.without-volume {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas:
        'play wave wave'
        '. both volume';
      justify-content: stretch;
      row-gap: var(--space-1);
    }
    .elapsed,
    .total {
      display: none;
    }
    .both {
      display: inline;
      grid-area: both;
    }
  }
  .play {
    grid-area: play;
    display: grid;
    place-items: center;
    width: var(--control);
    height: var(--control);
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-text);
    cursor: pointer;
  }
  .play:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .play svg {
    width: 1.25rem;
    height: 1.25rem;
    fill: currentColor;
  }
  .wave {
    grid-area: wave;
    height: 3rem;
    cursor: pointer;
    touch-action: none;
    border-radius: var(--radius-sm);
  }
  .wave:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .wave svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  g {
    fill: var(--text-muted);
    opacity: 0.4;
  }
  g.played {
    fill: var(--accent);
    opacity: 1;
  }
  .time {
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .volume {
    grid-area: volume;
  }
</style>
