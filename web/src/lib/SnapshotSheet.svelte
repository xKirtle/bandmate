<script lang="ts">
  // A Snapshot's Lyric Sheet, then its Scrapbook, read-only: each Section's
  // active Alternate, its Lines drawn as Read mode draws them, Chords above
  // the words. Its text can be selected and copied.
  import type { Section, Snapshot } from './api';
  import ChordedLine from './ChordedLine.svelte';
  import { activeAlternate } from './sections';

  let { sheet }: { sheet: Snapshot['sheet'] } = $props();

  const sections = $derived(new Map(sheet.sections.map((s) => [s.id, s])));
  const parts = $derived([
    { name: 'Lyric Sheet', ids: sheet.arrangement, empty: 'No Sections in the Lyric Sheet.' },
    { name: 'Scrapbook', ids: sheet.scrapbook, empty: 'Nothing in the Scrapbook.' },
  ]);
</script>

{#snippet sectionOf(section: Section)}
  {@const lines = activeAlternate(section)?.lines ?? []}
  <section class="section" aria-label={section.label || undefined}>
    {#if section.label}<h4>{section.label}</h4>{/if}
    {#if lines.length === 0}
      <p class="muted">No Lines yet.</p>
    {/if}
    {#each lines as line (line.id)}
      <ChordedLine {line} sizes="body" />
    {/each}
  </section>
{/snippet}

<div class="sheet">
  {#each parts as part (part.name)}
    <div class="part">
      <h3>{part.name}</h3>
      {#each part.ids as id (id)}
        {@const section = sections.get(id)}
        {#if section}{@render sectionOf(section)}{/if}
      {:else}
        <p class="muted">{part.empty}</p>
      {/each}
    </div>
  {/each}
</div>

<style>
  .sheet,
  .part {
    display: flex;
    flex-direction: column;
  }
  .sheet {
    gap: var(--space-8);
  }
  .part {
    gap: var(--space-6);
  }
  h3 {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  /* A Label heads its Lines, muted as in Read mode. */
  h4 {
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-md);
    font-weight: 700;
  }
  .section p {
    margin: 0;
  }
</style>
