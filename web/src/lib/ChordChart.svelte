<script lang="ts">
  // The Chord Chart, above the Lyric Sheet in Read mode: a diagram of a
  // Voicing for each Chord the Song shows, in one row that scrolls sideways.
  // Each draws the preferred Voicing for the Chord and the Song's tuning, or
  // the top-ranked one, as the Chord Finder would. A Chord that can't be read,
  // or has no Voicing, keeps its place as its name over an empty frame; a
  // tuning that can't be read gets no diagrams at all, rather than a guess.
  // A control at its start hides it, shows it, or pins it to the top of the
  // window, for every Song on this device. Clicking a diagram opens the
  // Chord's popover.
  import type { Song } from './api';
  import ChordDiagram from './ChordDiagram.svelte';
  import type { ChordOpener } from './ChordPopover.svelte';
  import Picker from './Picker.svelte';
  import { chartChords, chartTuning, chartVoicing } from './chordChart';
  import { chordChartStates, type ChordChartState } from './chordChartState';
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

  const chartState = $derived(chordChartState.current);
  const stateText: Record<ChordChartState, string> = { hidden: 'Hidden', shown: 'Shown', pinned: 'Pinned' };

  // Pinned, the Chart covers the top of the window, so following playback
  // scrolls a Section or Line into view below it rather than under it.
  let chart = $state<HTMLElement>();
  // Its content's height, bound to run the effect again as it changes; the
  // padding is the whole Chart's, border and all.
  let height = $state(0);
  $effect(() => {
    if (chartState !== 'pinned' || !chart || height === 0) return;
    const page = document.documentElement;
    page.style.scrollPaddingTop = `${chart.offsetHeight}px`;
    return () => page.style.removeProperty('scroll-padding-top');
  });
</script>

{#if names.length > 0}
  <section class={['chart', chartState]} aria-label="Chord Chart" bind:this={chart} bind:clientHeight={height}>
    <Picker
      id="chord-chart-state"
      class="state"
      options={chordChartStates}
      value={chartState}
      text={(s) => stateText[s]}
      onpick={chordChartState.set}
      aria-label="Chord Chart: {stateText[chartState]}"
      title="Hide, show or pin the Chord Chart"
    >
      {#snippet trigger(s)}
        <span class="state-button">
          {#if s === 'pinned'}
            <!-- A pushpin. -->
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 3h6M10 3v6l-3 4h10l-3-4V3M12 13v8" />
            </svg>
          {:else}
            <span class="chevron" aria-hidden="true">{s === 'hidden' ? '▸' : '▾'}</span>
          {/if}
          {#if s === 'hidden'}<span>Chord Chart</span>{/if}
        </span>
      {/snippet}
    </Picker>
    <!-- Hidden, the Chart collapses to its control, which brings it back. -->
    {#if chartState !== 'hidden'}
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
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  /* Stays at the top of the window, over the Lines scrolling under it,
     clear of a notch. */
  .pinned {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: max(0.5rem, env(safe-area-inset-top)) 0 0.5rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .chart > :global(.state) {
    flex: none;
  }
  .state-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    min-width: var(--control);
    height: var(--control);
    padding: 0 0.5rem;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-1);
    color: var(--text-muted);
    font-size: 0.875rem;
    font-weight: 600;
  }
  .state-button:hover {
    color: var(--text);
  }
  .state-button svg {
    width: 1.125rem;
    height: 1.125rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
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
    gap: 0.75rem;
    margin: 0;
    padding: 0 0 0.25rem;
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
    gap: 0.125rem;
    width: 100%;
    padding: 0.125rem;
    border: none;
    border-radius: 0.375rem;
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
