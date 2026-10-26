<script lang="ts">
  // The Chord Chart, above the Lyric Sheet in Read mode: a diagram of a
  // Voicing for each Chord the Song shows, in one row that scrolls sideways,
  // on the device's Instrument, the one the Chord Finder plays. Each draws
  // the preferred Voicing for the Chord (on the guitar, in the Song's
  // tuning), or the top-ranked one, as the Chord Finder would. On the piano,
  // every card draws the same keys, the whole octaves just covering every
  // key any of them presses, so they line up. A Chord that can't be read, or
  // has no Voicing, keeps its place as its name over an empty frame; on the
  // guitar, a tuning that can't be read gets no diagrams at all, rather than
  // a guess, while the piano has no tuning, so the Song's doesn't matter.
  // Hidden, it isn't drawn at all; it's hidden, shown and pinned to the top
  // of the window from the Reading menu, for every Song on this device, and
  // sized there by the Chart Size, one size for both Instruments.
  // Clicking a diagram opens the Chord's popover.
  import type { Song } from './api';
  import ChordDiagram from './ChordDiagram.svelte';
  import type { ChordOpener } from './ChordPopover.svelte';
  import { chartChords, chartContext, chartKeyRange, chartVoicing } from './chordChart';
  import { isPianoVoicing, whiteKeys } from './chordFinder';
  import PianoDiagram from './PianoDiagram.svelte';
  import { chartSize } from './sharedChartSize.svelte';
  import { chordChartState } from './sharedChordChartState.svelte';
  import { instrument } from './sharedInstrument.svelte';
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
  const context = $derived(chartContext(instrument.value, song.tuning));
  const piano = $derived(context?.instrument === 'piano');
  const chords = $derived.by(() => {
    if (!context) return [];
    const preferring = preferredVoicings.preferring(context);
    return names.map((name) => {
      const drawn = chartVoicing(name, preferring);
      return { name, voicing: drawn.kind === 'voicing' ? drawn.voicing : null };
    });
  });
  // The keys every piano card draws, worked out again as the Chords change.
  const range = $derived(
    chartKeyRange(chords.flatMap((c) => (c.voicing && isPianoVoicing(c.voicing) ? [c.voicing] : []))),
  );

  // The Chart Size, set on the page as a fraction, as the Lyric Size is: every
  // diagram and its Chord's name (--chart-read-name) scale by it.
  $effect(() => {
    const page = document.documentElement;
    page.style.setProperty('--chart-size', String(chartSize.value / 100));
    return () => page.style.removeProperty('--chart-size');
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

{#if names.length > 0 && shown}
  <section class={['chart', { pinned }]} aria-label="Chord Chart" bind:this={chart} bind:clientHeight={height}>
    {#if !context}
      <p class="muted note">
        The Song's tuning, “{song.tuning.trim()}”, can't be read, so the Chord Chart has no diagrams.
      </p>
    {:else}
      <ul
        class={['row', { piano }]}
        style:--chart-white-keys={piano ? whiteKeys(range.lowest, range.highest) : undefined}
      >
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
              {#if chord.voicing && isPianoVoicing(chord.voicing)}
                <!-- Read out low to high, e.g. "B7 on the piano: B3 D#4 F#4 A4". -->
                <PianoDiagram
                  pressed={chord.voicing.keys}
                  lowest={range.lowest}
                  highest={range.highest}
                  label="{chord.name} on the piano: {chord.voicing.notes.join(' ')}"
                />
              {:else if chord.voicing}
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
  </section>
{/if}

<style>
  .chart {
    display: flex;
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
  /* 6.5rem a Chord at 100%, scaled by the Chart Size, as its name is: the
     diagram, its starting fret drawn in its own units, scales with the
     width. */
  .row li {
    flex: 0 0 calc(6.5rem * var(--chart-size));
  }
  /* On the piano, a white key (1 wide to 4.5 tall) makes the keyboard as
     tall as a guitar diagram at the same Chart Size: that diagram's width
     inside the card's padding, at its viewBox's 128 wide to 126 tall. At a
     small Chart Size it's narrower than --piano-key-narrowest, as the user
     chose. Each card is the keyboard's width, --chart-white-keys keys, with
     its padding. */
  .row.piano {
    --piano-key: calc((6.5rem * var(--chart-size) - 2 * var(--space-1)) * 126 / 128 / 4.5);
  }
  .row.piano li {
    flex-basis: calc(var(--chart-white-keys) * var(--piano-key) + 2 * var(--space-1));
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
    font-size: var(--chart-read-name);
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The size of a diagram, so a Chord without one still holds its place:
     ChordDiagram's viewBox for six strings, or on the piano the keyboard. */
  .empty {
    box-sizing: border-box;
    width: 100%;
    aspect-ratio: 128 / 126;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
  }
  .piano .empty {
    aspect-ratio: calc(var(--chart-white-keys) / 4.5);
  }
</style>
