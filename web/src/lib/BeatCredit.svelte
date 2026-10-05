<script lang="ts">
  import type { Beat } from './api';
  import { formatDuration } from './time';

  // A Beat's credit in a line: who made it, linking to its source, and its
  // BPM, key and length.
  let { beat }: { beat: Beat } = $props();

  const facts = $derived(
    [beat.bpm ? `${beat.bpm} BPM` : '', beat.key, formatDuration(beat.duration)].filter(Boolean).join(' · '),
  );
</script>

<p class="muted tabular">
  {#if beat.producer && beat.sourceLink}
    <a href={beat.sourceLink} target="_blank" rel="noopener noreferrer">{beat.producer}</a>
  {:else if beat.sourceLink}
    <a href={beat.sourceLink} target="_blank" rel="noopener noreferrer">Source</a>
  {:else if beat.producer}
    {beat.producer}
  {:else}
    No producer credited
  {/if}
  · {facts}
</p>

<style>
  p {
    margin: 0;
    font-size: var(--text-md);
    overflow-wrap: anywhere;
  }
</style>
