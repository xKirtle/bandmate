<script lang="ts">
  import { api, type Beat } from './api';
  import AudioPlayer from './AudioPlayer.svelte';

  // The Beat Library's desktop player: the last Beat previewed, docked at the
  // bottom of the window across the content.
  let {
    beat,
    playing = $bindable(false),
    height = $bindable(0),
    onClose,
  }: {
    beat: Beat;
    playing?: boolean;
    /** The bar's height, which the page leaves free below its content. */
    height?: number;
    onClose: () => void;
  } = $props();

  let player = $state<AudioPlayer>();
  let box = $state<ResizeObserverSize[]>();
  $effect(() => {
    height = box?.[0].blockSize ?? 0;
  });
  let peaks = $state<number[]>([]);

  const src = $derived(api.beatAudioUrl(beat));
  const beatId = $derived(beat.id);

  // The list leaves out peaks: fetch the waveform for the Beat loaded here.
  $effect(() => {
    const id = beatId;
    void src;
    let current = true;
    peaks = [];
    api.getBeat(id).then(
      (b) => current && (peaks = b.peaks ?? []),
      // Without peaks the waveform stays flat; the audio still plays.
      () => {},
    );
    return () => {
      current = false;
    };
  });

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
    <!-- A new Beat starts playing as it loads; a replaced file waits to be played. -->
    {#key beatId}
      <AudioPlayer bind:this={player} bind:playing {src} duration={beat.duration} {peaks} autoplay />
    {/key}
  </div>
  <button type="button" class="icon" aria-label="Close the preview" onclick={onClose}>×</button>
</section>

<style>
  .player-bar {
    position: sticky;
    bottom: var(--nav-bottom-space);
    z-index: 1;
    display: grid;
    grid-template-columns: minmax(8rem, 16rem) minmax(0, 1fr) auto;
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
  .credit span {
    font-size: 0.875rem;
  }
</style>
