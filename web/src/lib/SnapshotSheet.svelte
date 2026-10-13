<script lang="ts">
  // A Snapshot's Lyric Sheet, then its Scrapbook, read-only: each Section's
  // active Alternate, its Lines drawn as Read mode draws them, Chords above
  // the words. Its text can be selected and copied.
  import type { Section, Snapshot } from './api';
  import { layoutLine } from './chords';
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
      {#if line.chords.length > 0}
        <div class="line chorded" class:chord-line={line.chordLine}>
          {#each layoutLine(line) as word, w (w)}
            <span class="word">
              {#each word as piece, p (p)}
                <span class="piece" class:snug={piece.snug}>
                  <span class="chord">{piece.chords.join(' ')}</span>
                  <span class="lyric">{piece.text || ' '}</span>
                </span>
              {/each}
            </span>
          {/each}
        </div>
      {:else}
        <p class="line plain">{line.lyrics || ' '}</p>
      {/if}
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
  .line {
    font-size: var(--text-lg);
    line-height: var(--leading-content);
  }
  .plain {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* Words wrap as wholes, each carrying its Chords above it. */
  .chorded {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
  }
  .word {
    display: inline-flex;
    flex-wrap: wrap;
    max-width: 100%;
    white-space: break-spaces;
    overflow-wrap: anywhere;
  }
  .piece {
    display: inline-flex;
    flex-direction: column;
    min-width: 0;
  }
  /* A piece with no Chord holds a Chord's height, so the lyrics stay level. */
  .chord {
    min-height: 1lh;
    color: var(--accent);
    font-size: var(--text-md);
    font-weight: 700;
  }
  .chord:not(:empty) {
    padding-right: var(--space-2);
  }
  .snug > .chord {
    padding-right: 0;
  }
  .chord-line .lyric {
    display: none;
  }
</style>
