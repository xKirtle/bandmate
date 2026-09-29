<script lang="ts">
  import { api, type Beat } from './api';
  import AudioPlayer from './AudioPlayer.svelte';
  import { loadBeatPeaks } from './beatPeaks';
  import PlayerVolume from './PlayerVolume.svelte';

  // The Beat Library's desktop player: the last Beat previewed, docked at the
  // bottom of the window across the content. It stays until the page closes it.
  let {
    beat,
    playing = $bindable(false),
    height = $bindable(0),
  }: {
    beat: Beat;
    playing?: boolean;
    /** The bar's height, which the page leaves free below its content. */
    height?: number;
  } = $props();

  let player = $state<AudioPlayer>();
  let box = $state<ResizeObserverSize[]>();
  $effect(() => {
    height = box?.[0].blockSize ?? 0;
  });
  let peaks = $state<number[]>([]);

  const src = $derived(api.beatAudioUrl(beat));
  const beatId = $derived(beat.id);

  // The waveform of the Beat loaded here, and again for a replaced file.
  $effect(() => {
    void src;
    peaks = [];
    return loadBeatPeaks(beatId, (p) => (peaks = p));
  });

  export function play() {
    player?.play();
  }

  export function toggle() {
    player?.toggle();
  }
</script>

<section class="player-bar" aria-label="Beat preview" bind:borderBoxSize={box}>
  <div class="credit">
    <strong>{beat.title}</strong>
    <span class="muted">{beat.producer || 'No producer credited'}</span>
  </div>
  <div class="player">
    <AudioPlayer bind:this={player} bind:playing {src} duration={beat.duration} {peaks} showVolume={false} />
  </div>
  <div class="volume"><PlayerVolume /></div>
</section>

<style>
  .player-bar {
    position: sticky;
    bottom: var(--nav-bottom-space);
    z-index: 1;
    display: grid;
    /* Equal sides keep the player at the window's centre, whatever the title.
       The player takes the width first, up to about its group at its widest
       (the waveform's 48rem cap plus play, times and gaps, in AudioPlayer), so
       narrower it shrinks while both sides keep room to read. */
    grid-template-columns: minmax(10rem, 1fr) minmax(0, 60rem) minmax(10rem, 1fr);
    align-items: center;
    gap: 1rem;
    padding: 0.5rem var(--gutter) max(0.5rem, env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  .credit {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .credit > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .volume {
    justify-self: end;
  }
  .credit span {
    font-size: 0.875rem;
  }
</style>
