<script lang="ts">
  import { api, type Beat } from './api';
  import AudioPlayer from './AudioPlayer.svelte';
  import BeatCredit from './BeatCredit.svelte';
  import BeatEditDialog from './BeatEditDialog.svelte';
  import { loadBeatPeaks } from './beatPeaks';

  // One Beat in the Beat Library's card list: its credit and a preview player.
  // Its details, file and deletion are edited in a dialog.
  let {
    beat,
    maxUploadBytes,
    onChange,
    onDelete,
  }: {
    beat: Beat;
    maxUploadBytes: number;
    onChange: (beat: Beat) => void;
    onDelete: (id: number) => void;
  } = $props();

  let editing = $state(false);

  const inUse = $derived(beat.songs.length > 0);
  // Changes when the Beat's file is replaced, not when its details are edited.
  const src = $derived(api.beatAudioUrl(beat));
  const beatId = $derived(beat.id);

  // The list leaves out peaks: fetch the waveform once the Beat scrolls into
  // view, and again for a replaced file.
  let article = $state<HTMLElement>();
  let seen = $state(false);
  let peaks = $state<number[]>([]);

  $effect(() => {
    if (!article || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) seen = true;
      },
      { rootMargin: '200px' },
    );
    observer.observe(article);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (!seen) return;
    void src;
    peaks = [];
    return loadBeatPeaks(beatId, (p) => (peaks = p));
  });
</script>

<article bind:this={article} class="beat" aria-labelledby="beat-{beat.id}-title">
  <div class="head">
    <div class="credit">
      <h2 id="beat-{beat.id}-title">{beat.title}</h2>
      <BeatCredit {beat} />
    </div>
    <button type="button" id="edit-beat-{beat.id}" class="button" onclick={() => (editing = true)}>Edit</button>
  </div>

  <AudioPlayer {src} duration={beat.duration} {peaks} />

  {#if inUse}
    <p class="songs muted">Used in {beat.songs.map((s) => s.title).join(', ')}</p>
  {/if}

  {#if beat.notes}
    <p class="notes">{beat.notes}</p>
  {/if}
</article>

{#if editing}
  <BeatEditDialog {beat} {maxUploadBytes} {onChange} {onDelete} onClose={() => (editing = false)} />
{/if}

<style>
  .beat {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 0.25rem;
    border-bottom: 1px solid var(--border);
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .credit {
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
    overflow-wrap: anywhere;
  }
  .songs,
  .notes {
    margin: 0;
    font-size: var(--text-md);
    overflow-wrap: anywhere;
  }
  .notes {
    white-space: pre-wrap;
  }
</style>
