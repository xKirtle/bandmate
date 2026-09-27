<script lang="ts">
  import { api, type Master } from './api';
  import { playAlone } from './playback';
  import { formatDuration } from './time';
  import { bars } from './waveform';

  // A Master's player: its waveform, which seeks when clicked, and
  // play/pause. The audio streams through an <audio> element, fetching only
  // the parts played.
  let { songId, master }: { songId: number; master: Master } = $props();

  const barCount = 160;

  let audio = $state<HTMLAudioElement>();
  let playing = $state(false);
  let time = $state(0);
  let peaks = $state<number[]>([]);

  // The Song is replaced after every change to it; only another Master
  // needs its peaks fetched again.
  const masterId = $derived(master.id);
  $effect(() => {
    const id = masterId;
    let current = true;
    api.getMaster(songId, id).then(
      (m) => current && (peaks = m.peaks ?? []),
      // Without peaks the waveform stays flat; the audio still plays.
      () => {},
    );
    return () => {
      current = false;
    };
  });

  const shape = $derived(bars(peaks, barCount));
  const duration = $derived(master.duration);
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

  function toggle() {
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => (playing = false));
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
  <audio
    bind:this={audio}
    src={api.masterAudioUrl(songId, master.id)}
    preload="none"
    onplay={(e) => {
      playAlone(e);
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
    <svg viewBox="0 0 {barCount} 100" preserveAspectRatio="none" aria-hidden="true">
      {#each shape as peak, i (i)}
        {@const height = Math.max(2, peak * 100)}
        <rect
          class:played={i < played * barCount}
          x={i + 0.15}
          y={(100 - height) / 2}
          width="0.7"
          {height}
        />
      {/each}
    </svg>
  </div>

  <span class="time muted">{formatDuration(time)} / {formatDuration(duration)}</span>
</div>

<style>
  .player {
    display: flex;
    align-items: center;
    gap: 0.75rem;
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
  .wave {
    flex: 1;
    min-width: 0;
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
  rect {
    fill: var(--text-muted);
    opacity: 0.4;
  }
  rect.played {
    fill: var(--accent);
    opacity: 1;
  }
  .time {
    flex-shrink: 0;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
  }
</style>
