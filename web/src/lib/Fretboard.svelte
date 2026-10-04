<script lang="ts">
  // The fretboard Name it places a shape on: the strings upright, the low
  // string on the left (on the right for a left-handed player), the nut at
  // the top, as a chord diagram draws them. Tapping a fret places the
  // string's one finger there, and tapping it again lifts it, leaving the
  // string open. Above the nut, a string is marked open or muted. With a
  // capo on, frets count from it: it's drawn as the nut, and labelled. Arrow
  // keys move between the frets, so the whole fretboard is one tab stop.
  import { tick } from 'svelte';
  import type { Frets } from './chordFinder';
  import { leftHanded } from './sharedLeftHanded.svelte';

  let {
    frets = $bindable(),
    capo = 0,
  }: {
    /** Each string's fret, low string to high, counted from the capo: 0 for open, null for muted. */
    frets: Frets;
    capo?: number;
  } = $props();

  /** The frets above the nut (or capo) a finger can be placed on, as far as a Voicing reaches. */
  const fretCount = 12;
  /** The frets a fretboard marks with an inlay, so a fret is easy to find. */
  const inlays = new Set([3, 5, 7, 9, 12]);

  const strings = $derived(frets.length);
  /** The strings in the order they're drawn, left to right: mirrored for a left-handed player. */
  const order = $derived(Array.from({ length: strings }, (_, i) => (leftHanded.on ? strings - 1 - i : i)));
  /** Row 0 is above the nut; rows 1 to fretCount are the frets. */
  const rows = Array.from({ length: fretCount + 1 }, (_, fret) => fret);

  /** A string as players name it, the high one 1st: the low string of six is the 6th. */
  function stringName(string: number): string {
    const n = strings - string;
    return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th') + ' string';
  }

  function set(string: number, fret: number | null) {
    frets = frets.map((f, s) => (s === string ? fret : f));
  }

  /** Above the nut: a muted string rings open, any other is muted. */
  const tapNut = (string: number) => set(string, frets[string] === null ? 0 : null);
  /** On a fret: places the string's finger there, or lifts it if it's there already. */
  const tapFret = (string: number, fret: number) => set(string, frets[string] === fret ? 0 : fret);

  function nutLabel(string: number): string {
    const f = frets[string];
    const state = f === null ? 'muted' : f === 0 ? 'open' : `fret ${f}`;
    return `${stringName(string)}: ${state}`;
  }

  // The one button in the tab order: where focus last was, the 6th string's nut at first.
  let focused = $state({ column: 0, row: 0 });
  let board: HTMLDivElement;

  async function move(e: KeyboardEvent, column: number, row: number) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [column - 1, row],
      ArrowRight: [column + 1, row],
      ArrowUp: [column, row - 1],
      ArrowDown: [column, row + 1],
      Home: [0, row],
      End: [strings - 1, row],
    };
    const to = moves[e.key];
    if (!to) return;
    e.preventDefault();
    focused = { column: Math.max(0, Math.min(strings - 1, to[0])), row: Math.max(0, Math.min(fretCount, to[1])) };
    await tick();
    board.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }
</script>

<div
  bind:this={board}
  class="fretboard"
  role="group"
  aria-label="Fretboard{capo > 0 ? `, frets counted from capo ${capo}` : ''}"
  style:--strings={strings}
>
  {#each rows as row (row)}
    <span class="gutter" class:inlay={inlays.has(row)} class:capo={row === 0 && capo > 0}>
      {#if row === 0}{capo > 0 ? `Capo ${capo}` : ''}{:else}{row}{/if}
    </span>
    {#each order as string, column (string)}
      {@const fret = frets[string]}
      {#if row === 0}
        <button
          type="button"
          class="nut"
          class:capo={capo > 0}
          tabindex={focused.column === column && focused.row === row ? 0 : -1}
          aria-label={nutLabel(string)}
          title={fret === null ? 'Ring this string open' : 'Mute this string'}
          onclick={() => tapNut(string)}
          onkeydown={(e) => move(e, column, row)}
          onfocus={() => (focused = { column, row })}
        >
          {#if fret === 0}
            <span class="open" aria-hidden="true"></span>
          {:else if fret === null}
            <span class="muted" aria-hidden="true">×</span>
          {/if}
        </button>
      {:else}
        <button
          type="button"
          class="fret"
          tabindex={focused.column === column && focused.row === row ? 0 : -1}
          aria-label="{stringName(string)}, fret {row}"
          aria-pressed={fret === row}
          onclick={() => tapFret(string, row)}
          onkeydown={(e) => move(e, column, row)}
          onfocus={() => (focused = { column, row })}
        >
          {#if fret === row}<span class="finger" aria-hidden="true"></span>{/if}
        </button>
      {/if}
    {/each}
  {/each}
</div>

<style>
  .fretboard {
    display: grid;
    grid-template-columns: 2.5rem repeat(var(--strings), minmax(0, 1fr));
    grid-auto-rows: 2rem;
    width: 100%;
    max-width: 22rem;
  }
  @media (min-width: 40rem) {
    .fretboard {
      grid-auto-rows: 1.875rem;
    }
  }
  .gutter {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 0.5rem;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }
  .gutter.inlay {
    color: var(--text);
    font-weight: 700;
  }
  .gutter.capo {
    font-size: 0.6875rem;
    font-weight: 600;
    white-space: nowrap;
  }
  button {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  /* The string, down the middle of each fret, and the fret wire under it. */
  .fret::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    background: var(--text-muted);
  }
  .fret {
    border-bottom: 1px solid var(--text-muted);
  }
  .fret:hover::after {
    content: '';
    position: absolute;
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.35;
  }
  /* The nut, or the capo as the nut: under the open and muted marks. */
  .nut {
    border-bottom: 4px solid var(--text);
  }
  .nut.capo {
    border-bottom-width: 6px;
    border-bottom-color: var(--accent);
  }
  .open {
    width: 0.75rem;
    height: 0.75rem;
    border: 1.5px solid var(--text);
    border-radius: 50%;
  }
  .muted {
    font-size: 1.125rem;
    line-height: 1;
  }
  .finger {
    position: relative;
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 50%;
    background: var(--text);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: 0.25rem;
  }
</style>
