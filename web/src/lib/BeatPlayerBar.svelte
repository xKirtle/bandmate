<script lang="ts">
  import { api } from './api';
  import AudioPlayer from './AudioPlayer.svelte';
  import { loadBeatPeaks } from './beatPeaks';
  import { previewCredit, type Preview } from './beatPreview';
  import PlayerVolume from './PlayerVolume.svelte';

  // The Beat Library's desktop player: the last Beat or staged file
  // previewed, docked at the bottom of the window across the content. It
  // stays until the page closes it.
  let {
    preview,
    playing = $bindable(false),
    height = $bindable(0),
  }: {
    preview: Preview;
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

  const beat = $derived('beat' in preview ? preview.beat : null);
  const row = $derived('row' in preview ? preview.row : null);
  const credit = $derived(previewCredit(preview));

  // A staged file plays straight from the file picked, without uploading it,
  // through a URL let go of once another file or Beat takes its place.
  const file = $derived(row?.file ?? null);
  let fileUrl = $state<string | null>(null);
  $effect.pre(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    fileUrl = url;
    return () => {
      URL.revokeObjectURL(url);
      fileUrl = null;
    };
  });

  const src = $derived(beat ? api.beatAudioUrl(beat) : (fileUrl ?? ''));
  const duration = $derived(beat?.duration ?? row?.decoded?.duration ?? 0);
  const beatId = $derived(beat?.id ?? null);

  // The waveform of the Beat loaded here, and again for a replaced file. A
  // staged file's was worked out when it was read.
  $effect(() => {
    void src;
    if (beatId === null) {
      peaks = row?.decoded?.peaks ?? [];
      return;
    }
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
    <strong>{credit.title}</strong>
    <span class="muted">{credit.byline}</span>
  </div>
  <div class="player">
    <AudioPlayer bind:this={player} bind:playing {src} {duration} {peaks} showVolume={false} />
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
    font-size: var(--text-md);
  }
</style>
