<script lang="ts">
  import { playMediaAlone } from './playback';
  import { canSetVolume, playerVolume } from './playerVolume.svelte';
  import { formatDuration } from './time';
  import { gain, loudness } from './volume';
  import { bars } from './waveform';

  // A player for a Master or a Beat preview: its waveform, which seeks when
  // clicked, play/pause and the volume every such player shares. The audio
  // streams through an <audio> element, fetching only the parts played.
  let {
    src,
    duration,
    peaks,
    playing = $bindable(false),
  }: {
    src: string;
    /** In seconds. */
    duration: number;
    /** The waveform; flat while empty, and the audio still plays. */
    peaks: number[];
    /** Whether the audio is playing, e.g. for a button elsewhere that shows it. */
    playing?: boolean;
  } = $props();

  const barCount = 160;
  // Names this player's clip apart from any other player's on the page.
  const uid = $props.id();
  const clipId = `played-${uid}`;

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
  <div class="controls">
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

    <button type="button" class="play" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
      {#if playing}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
      {/if}
    </button>

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
      <!-- The bars are drawn twice: the played copy over the rest, clipped to
           the played width, so it fills smoothly, partway through a bar. -->
      <svg viewBox="0 0 {barCount} 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <rect width={played * barCount} height="100" />
          </clipPath>
        </defs>
        {#each [false, true] as isPlayed (isPlayed)}
          <g class:played={isPlayed} clip-path={isPlayed ? `url(#${clipId})` : undefined}>
            {#each shape as peak, i (i)}
              {@const height = Math.max(2, peak * 100)}
              <rect x={i + 0.15} y={(100 - height) / 2} width="0.7" {height} />
            {/each}
          </g>
        {/each}
      </svg>
    </div>

    <span class="time muted">{formatDuration(time)} / {formatDuration(duration)}</span>

    <div class="volume">
      <button
        type="button"
        class="speaker"
        onclick={playerVolume.toggleMute}
        aria-label={volume.muted ? 'Unmute' : 'Mute'}
        aria-pressed={volume.muted}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path class="cone" d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
          {#if loudness(volume) === 'muted'}
            <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
          {:else}
            <path d="M15 9a4 4 0 0 1 0 6" />
            {#if loudness(volume) === 'high'}
              <path d="M17.5 6.5a7.5 7.5 0 0 1 0 11" />
            {/if}
          {/if}
        </svg>
      </button>
      {#if slider}
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume.muted ? 0 : volume.level}
          oninput={(e) => playerVolume.setLevel(e.currentTarget.valueAsNumber)}
          aria-label="Volume"
          aria-valuetext={volume.muted ? 'Muted' : `${Math.round(volume.level * 100)}%`}
        />
      {/if}
    </div>
  </div>
</div>

<style>
  /* The layout follows the player's own width, wherever it is placed. As a
     container it takes that width from its parent, not from its contents. */
  .player {
    container-type: inline-size;
  }
  .controls {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    grid-template-areas: 'play wave time volume';
    align-items: center;
    gap: 0.75rem;
  }
  /* Narrow, the waveform takes the whole top row after play. Under it, the time
     starts at its left edge and the volume sits at the right. The volume slider
     shows either way: wrapped, it no longer takes width from the waveform. */
  @container (max-width: 32rem) {
    .controls {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas:
        'play wave wave'
        '. time volume';
      row-gap: 0.25rem;
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
  .wave {
    grid-area: wave;
    height: 3rem;
    cursor: pointer;
    touch-action: none;
    border-radius: 0.25rem;
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
    grid-area: time;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }
  .volume {
    grid-area: volume;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .speaker {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .speaker:hover {
    color: var(--text);
  }
  .speaker:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .speaker svg {
    width: 1.25rem;
    height: 1.25rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .speaker .cone {
    fill: currentColor;
  }
  input[type='range'] {
    width: 5rem;
    min-height: 0;
    padding: 0;
    accent-color: var(--accent);
  }
</style>
