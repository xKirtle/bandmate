<script lang="ts">
  // The fretboard Name it places a shape on, drawn as a guitar's neck: the
  // strings upright, the low string on the left (on the right for a
  // left-handed player), the nut at the top, as a chord diagram draws them,
  // on a fingerboard like the Tuner's headstock, its frets closing up the
  // neck and its inlays on the board. Tapping a fret places the string's one
  // finger there, and tapping it again lifts it, leaving the string open.
  // Above the nut, a string is marked open or muted. Arrow keys move between
  // the frets, so the whole fretboard is one tab stop.
  import { tick } from 'svelte';
  import { stringNumber, type Frets } from './chordFinder';
  import { leftHanded } from './sharedLeftHanded.svelte';

  let {
    frets = $bindable(),
  }: {
    /** Each string's fret, low string to high: 0 for open, null for muted. */
    frets: Frets;
  } = $props();

  /** The frets above the nut a finger can be placed on, as far as a Voicing reaches. */
  const fretCount = 12;
  /** The frets a fretboard marks with an inlay, so a fret is easy to find; the 12th's is a double. */
  const inlays = [3, 5, 7, 9, 12];

  const strings = $derived(frets.length);
  /** The strings in the order they're drawn, left to right: mirrored for a left-handed player. */
  const order = $derived(Array.from({ length: strings }, (_, i) => (leftHanded.value ? strings - 1 - i : i)));
  /** Row 0 is above the nut; rows 1 to fretCount are the frets. */
  const rows = Array.from({ length: fretCount + 1 }, (_, fret) => fret);

  /** Each row's height: above the nut 2rem, then the frets closing evenly from 2.5rem at the 1st to 2rem at the last. */
  const rowHeights = rows
    .map((fret) => (fret === 0 ? '2rem' : `${2.5 - (0.5 * (fret - 1)) / (fretCount - 1)}rem`))
    .join(' ');

  /** How thick a string is drawn: 2.5px for the low string, thinning evenly to 1px for the high one. */
  const gauge = (string: number) => `${2.5 - (1.5 * string) / Math.max(1, strings - 1)}px`;

  /** A string as players name it: the low string of six is the 6th string. */
  const stringName = (string: number) => `${stringNumber(string, strings)} string`;

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
  aria-label="Fretboard"
  style:--strings={strings}
  style:grid-template-rows={rowHeights}
>
  <!-- Under the strings, every cell placed so these don't push the strings
       aside: the fingerboard, the nut, and the inlays. -->
  <span class="board" aria-hidden="true"></span>
  <span class="nut-bar" aria-hidden="true"></span>
  {#each inlays as fret (fret)}
    <span class="inlay" class:double={fret === fretCount} style:grid-row={fret + 1} aria-hidden="true">
      <span></span>
      {#if fret === fretCount}<span></span>{/if}
    </span>
  {/each}

  {#each rows as row (row)}
    <span class="gutter" class:inlaid={inlays.includes(row)} style:grid-row={row + 1}>
      {#if row > 0}{row}{/if}
    </span>
    {#each order as string, column (string)}
      {@const fret = frets[string]}
      {#if row === 0}
        <button
          type="button"
          class="nut"
          style:grid-row={1}
          style:grid-column={column + 2}
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
          class:last={row === fretCount}
          style:grid-row={row + 1}
          style:grid-column={column + 2}
          style:--gauge={gauge(string)}
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
    width: 100%;
    max-width: var(--fretboard-neck);
  }
  /* Positioned, as the strings are, so they're drawn under them in order. */
  .board,
  .nut-bar,
  .inlay {
    position: relative;
    grid-column: 2 / -1;
  }
  .board {
    grid-row: 2 / -1;
    background: var(--surface-2);
  }
  .nut-bar {
    grid-row: 1;
    align-self: end;
    height: var(--space-1);
    background: var(--text-muted);
  }
  .inlay {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* The 12th's two dots, a third of the way in from either side. */
  .inlay.double {
    justify-content: space-evenly;
  }
  .inlay > span {
    width: 0.625rem;
    height: 0.625rem;
    border-radius: var(--radius-full);
    background: var(--text-muted);
    opacity: 0.3;
  }
  .gutter {
    display: flex;
    grid-column: 1;
    align-items: center;
    justify-content: flex-end;
    padding-right: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .gutter.inlaid {
    color: var(--text);
    font-weight: 700;
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
  /* The string, down the middle of each fret at its gauge, and the fret wire under it. */
  .fret::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(50% - var(--gauge) / 2);
    width: var(--gauge);
    background: var(--text-muted);
  }
  .fret {
    border-bottom: 1px solid var(--text-muted);
  }
  /* The neck goes on past the last fret, so no wire closes it. */
  .fret.last {
    border-bottom: 0;
  }
  .fret:hover::after {
    content: '';
    position: absolute;
    width: 0.875rem;
    height: 0.875rem;
    border-radius: var(--radius-full);
    background: var(--text-muted);
    opacity: 0.35;
  }
  /* Above the nut bar, the open and muted marks. */
  .nut {
    padding-bottom: var(--space-1);
  }
  .open {
    width: 0.75rem;
    height: 0.75rem;
    border: 1.5px solid var(--text);
    border-radius: var(--radius-full);
  }
  .muted {
    font-size: var(--text-xl);
    line-height: 1;
  }
  .finger {
    position: relative;
    width: 1.125rem;
    height: 1.125rem;
    border-radius: var(--radius-full);
    background: var(--accent);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: var(--radius-sm);
  }
</style>
