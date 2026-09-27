<script lang="ts">
  import type { Song } from './api';
  import { layoutLine } from './chords';

  let { song, showChords }: { song: Song; showChords: boolean } = $props();

  const sections = $derived(new Map(song.sections.map((s) => [s.id, s])));
</script>

<div class="view">
  {#each song.arrangement as occurrence (occurrence.id)}
    {@const section = sections.get(occurrence.sectionId)}
    {#if section}
      {@const all = section.alternates.find((a) => a.active)!.lines}
      {@const lines = all.filter((l) => showChords || !l.chordLine)}
      <section class="section" aria-label={section.label || 'Section without a Label'}>
        {#if section.label}<h3>{section.label}</h3>{/if}
        {#if all.length === 0}
          <p class="muted">No Lines yet.</p>
        {:else if lines.length === 0}
          <p class="muted">Only Chords, which are hidden.</p>
        {/if}
        {#each lines as line (line.id)}
          {#if showChords && line.chords.length > 0}
            <div class="line" class:chord-line={line.chordLine}>
              {#each layoutLine(line) as word, w (w)}
                <span class="word">
                  {#each word as piece, p (p)}
                    <span class="piece">
                      <span class="chord">{piece.chord}</span>
                      <span class="lyric">{piece.text || ' '}</span>
                    </span>
                  {/each}
                </span>
              {/each}
            </div>
          {:else}
            <p class="line plain">{line.lyrics || ' '}</p>
          {/if}
        {/each}
      </section>
    {/if}
  {/each}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    margin-bottom: 0.75rem;
  }
  h3 {
    margin: 0 0 0.25rem;
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .section p {
    margin: 0;
  }
  .line {
    font-size: 1.0625rem;
    line-height: 1.4;
  }
  .plain {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* Words wrap as wholes, each carrying its Chords above it. */
  .line:not(.plain) {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    margin-top: 0.25rem;
  }
  /* A word wider than the screen wraps inside rather than overflowing. */
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
  .chord {
    min-height: 1.4em;
    color: var(--accent);
    font-size: 0.9375rem;
    font-weight: 700;
  }
  .chord:not(:empty) {
    padding-right: 0.375em;
  }
  .chord-line .lyric {
    display: none;
  }
</style>
