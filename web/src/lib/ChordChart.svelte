<script lang="ts">
  // The Chord Chart, above the Lyric Sheet in Read mode: a diagram of a
  // Voicing for each Chord the Song shows, in one row that scrolls sideways.
  // Each draws the preferred Voicing for the Chord and the Song's tuning, or
  // the top-ranked one, as the Chord Finder would. A Chord that can't be read,
  // or has no Voicing, keeps its place as its name over an empty frame; a
  // tuning that can't be read gets no diagrams at all, rather than a guess.
  // Two buttons at its start hide or show it, and pin it to the top of the
  // window, for every Song on this device. Clicking a diagram opens the
  // Chord's popover.
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Pin from '@lucide/svelte/icons/pin';
  import type { Song } from './api';
  import ChordDiagram from './ChordDiagram.svelte';
  import type { ChordOpener } from './ChordPopover.svelte';
  import { chartChords, chartTuning, chartVoicing } from './chordChart';
  import { chordChartState } from './sharedChordChartState.svelte';
  import { preferredVoicings } from './sharedPreferredVoicings.svelte';

  let {
    song,
    transpose = 0,
    opener,
  }: {
    song: Song;
    transpose?: number;
    /** Given, clicking a diagram opens its Chord's popover. */
    opener?: ChordOpener;
  } = $props();

  const names = $derived(chartChords(song, transpose));
  const tuning = $derived(chartTuning(song.tuning));
  const chords = $derived.by(() => {
    if (!tuning) return [];
    const preferred = preferredVoicings.of(tuning);
    return names.map((name) => {
      const drawn = chartVoicing(name, tuning, preferred);
      return { name, voicing: drawn.kind === 'voicing' ? drawn.voicing : null };
    });
  });

  const shown = $derived(chordChartState.current.shown);
  const pinned = $derived(chordChartState.current.pinned);

  // Pinned, the Chart covers the top of the window, so following playback
  // scrolls a Section or Line into view below it rather than under it.
  let chart = $state<HTMLElement>();
  // Its content's height, bound to run the effect again as it changes; the
  // padding is the whole Chart's, border and all.
  let height = $state(0);
  $effect(() => {
    if (!shown || !pinned || !chart || height === 0) return;
    const page = document.documentElement;
    page.style.scrollPaddingTop = `${chart.offsetHeight}px`;
    return () => page.style.removeProperty('scroll-padding-top');
  });
</script>

{#if names.length > 0}
  <section
    class={['chart', { pinned: shown && pinned }]}
    aria-label="Chord Chart"
    bind:this={chart}
    bind:clientHeight={height}
  >
    <div class="controls">
      <button
        type="button"
        class="control"
        aria-pressed={shown}
        onclick={() => chordChartState.setShown(!shown)}
        aria-label="Show the Chord Chart"
        title={shown ? 'Hide the Chord Chart' : 'Show the Chord Chart'}
      >
        <!-- An eye, crossed out while the Chart is hidden. -->
        {#if shown}<Eye />{:else}<EyeOff />{/if}
        {#if !shown}<span>Chord Chart</span>{/if}
      </button>
      <!-- Hidden, the pin goes too, keeping whether it's pinned for when it's shown. -->
      {#if shown}
        <button
          type="button"
          class="control"
          aria-pressed={pinned}
          onclick={() => chordChartState.setPinned(!pinned)}
          aria-label="Pin the Chord Chart to the top"
          title={pinned ? 'Unpin the Chord Chart' : 'Pin the Chord Chart to the top'}
        >
          <!-- A pushpin, filled while pinned. -->
          <Pin />
        </button>
      {/if}
    </div>
    <!-- Hidden, the Chart collapses to its control, which brings it back. -->
    {#if shown}
      {#if !tuning}
        <p class="muted note">
          The Song's tuning, “{song.tuning.trim()}”, can't be read, so the Chord Chart has no diagrams.
        </p>
      {:else}
        <ul class="row">
          {#each chords as chord (chord.name)}
            <li>
              <button
                type="button"
                class="chord"
                aria-haspopup="dialog"
                title="Open {chord.name}'s diagram"
                onclick={(e) => opener?.press(chord.name, e.currentTarget)}
              >
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
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
{/if}

<style>
  /* The control, then the row of diagrams beside it. */
  .chart {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  /* Stays at the top of the window, over the Lines scrolling under it,
     clear of a notch. */
  .pinned {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: max(var(--space-2), env(safe-area-inset-top)) 0 var(--space-2);
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  /* The eye above the pin, so together they're no wider than one. */
  .controls {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .control {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-width: var(--control);
    height: var(--control);
    padding: 0 var(--space-2);
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-md);
    font-weight: 600;
    cursor: pointer;
  }
  .control:hover {
    color: var(--text);
  }
  .control[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }
  /* A size up from the label beside it. */
  .control :global(.lucide-icon) {
    font-size: var(--text-lg);
  }
  .control[aria-pressed='true'] :global(.lucide-pin) {
    fill: currentColor;
  }
  .note {
    flex: 1;
    align-self: center;
    margin: 0;
  }
  /* One row, scrolling sideways when it overflows, at any width. */
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: var(--space-3);
    margin: 0;
    padding: 0 0 var(--space-1);
    list-style: none;
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }
  .row li {
    flex: 0 0 4.5rem;
  }
  /* A diagram under its Chord's name, which opens its popover. */
  .chord {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-1);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .chord:hover {
    background: var(--surface-1);
  }
  .name {
    max-width: 100%;
    overflow: hidden;
    color: var(--accent);
    font-size: var(--text-lg);
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
    border-radius: var(--radius-sm);
  }
</style>
