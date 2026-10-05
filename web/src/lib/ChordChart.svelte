<script lang="ts">
  // The Chord Chart, above the Lyric Sheet in Read mode: a diagram of a
  // Voicing for each Chord the Song shows, in one row that scrolls sideways.
  // Each draws the preferred Voicing for the Chord and the Song's tuning, or
  // the top-ranked one, as the Chord Finder would. A Chord that can't be read,
  // or has no Voicing, keeps its place as its name over an empty frame; a
  // tuning that can't be read gets no diagrams at all, rather than a guess.
  import type { Song } from './api';
  import ChordDiagram from './ChordDiagram.svelte';
  import { chartChords, chartTuning } from './chordChart';
  import { lookUp } from './chordFinder';
  import { preferredVoicings } from './sharedPreferredVoicings.svelte';

  let { song, transpose = 0 }: { song: Song; transpose?: number } = $props();

  const names = $derived(chartChords(song, transpose));
  const tuning = $derived(chartTuning(song.tuning));
  const chords = $derived.by(() => {
    if (!tuning) return [];
    const context = { tuning, preferred: preferredVoicings.of(tuning) };
    return names.map((name) => {
      const found = lookUp(name, context);
      return { name, voicing: found.kind === 'chord' ? (found.voicings[0] ?? null) : null };
    });
  });
</script>

{#if names.length > 0}
  <section class="chart" aria-label="Chord Chart">
    {#if !tuning}
      <p class="muted note">
        The Song's tuning, “{song.tuning.trim()}”, can't be read, so the Chord Chart has no diagrams.
      </p>
    {:else}
      <ul class="row">
        {#each chords as chord (chord.name)}
          <li>
            <span class="name" title={chord.name}>{chord.name}</span>
            {#if chord.voicing}
              <ChordDiagram voicing={chord.voicing} name={chord.name} />
            {:else}
              <span
                class="empty"
                role="img"
                aria-label="{chord.name}: no diagram"
                title="No diagram: Bandmate can't read this Chord or find a Voicing for it"
              ></span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .chart {
    margin-bottom: 1rem;
  }
  .note {
    margin: 0;
  }
  /* One row, scrolling sideways when it overflows, at any width. */
  .row {
    display: flex;
    gap: 0.75rem;
    margin: 0;
    padding: 0 0 0.25rem;
    list-style: none;
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }
  .row li {
    display: flex;
    flex: 0 0 4.5rem;
    flex-direction: column;
    align-items: center;
    gap: 0.125rem;
  }
  .name {
    max-width: 100%;
    overflow: hidden;
    color: var(--accent);
    font-size: 0.9375rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The size of a diagram, so a Chord without one still holds its place:
     ChordDiagram's viewBox for six strings. */
  .empty {
    box-sizing: border-box;
    width: 100%;
    aspect-ratio: 112 / 126;
    border: 1px dashed var(--border);
    border-radius: 0.375rem;
  }
</style>
