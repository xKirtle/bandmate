<script lang="ts">
  // Draws a guitar Voicing as a chord diagram: the strings upright, the low
  // string on the left, the nut (or the fret the Voicing starts at, up the
  // neck or at its barre) at the top. Above it, ○ marks a string that rings open and × one
  // that's muted. On a left-handed device it's mirrored, the low string on
  // the right. The Chord Finder and the Chord Chart both draw with it.
  import type { Voicing } from './chordFinder';
  import { diagramStartFret } from './guitar';
  import { leftHanded } from './sharedLeftHanded.svelte';

  let { voicing, name }: { voicing: Voicing; name: string } = $props();

  /** How many frets the diagram shows. A Voicing spans four at most. */
  const rows = 5;
  const stringGap = 16;
  const fretGap = 20;
  /** Room on the left for the starting fret, and above for the open and muted marks. */
  const left = 22;
  const top = 20;
  const right = 10;
  const bottom = 6;

  const strings = $derived(voicing.frets.length);
  /** From the low string to the high one. */
  const neckWidth = $derived((strings - 1) * stringGap);
  const width = $derived(left + neckWidth + right);
  const height = top + rows * fretGap + bottom;

  /** The fret the diagram's first row is: a barre's, else 1 under the nut when the Voicing fits there. */
  const start = $derived(diagramStartFret(voicing, rows));

  /**
   * Where a string is drawn, counted from the low one: mirrored for a
   * left-handed player. The neck's edges are left and left + neckWidth,
   * whichever way it's drawn, never x(0).
   */
  const x = (string: number) => left + (leftHanded.value ? strings - 1 - string : string) * stringGap;
  /** The middle of a fret's row, where a finger presses. */
  const y = (fret: number) => top + (fret - start + 0.5) * fretGap;

  /** The dots a finger presses, leaving out what the barre covers. */
  const dots = $derived(
    voicing.frets.flatMap((fret, string) => {
      if (fret === null || fret === 0) return [];
      const b = voicing.barre;
      if (b && fret === b.fret && string >= b.from && string <= b.to) return [];
      return [{ string, fret }];
    }),
  );

  /** Read out low string to high, e.g. "C: x 3 2 0 1 0", starting at fret 5 up the neck. */
  const label = $derived(
    `${name}: ${voicing.frets.map((f) => (f === null ? 'x' : f)).join(' ')}` +
      (start > 1 ? `, from fret ${start}` : ''),
  );
</script>

<svg class="diagram" viewBox="0 0 {width} {height}" role="img" aria-label={label}>
  <!-- Frets, then strings over them. -->
  {#each { length: rows + 1 } as _, i (i)}
    <line class="fret" x1={left} x2={left + neckWidth} y1={top + i * fretGap} y2={top + i * fretGap} />
  {/each}
  {#each { length: strings } as _, s (s)}
    <line class="string" x1={x(s)} x2={x(s)} y1={top} y2={top + rows * fretGap} />
  {/each}
  {#if start === 1}
    <rect class="nut" x={left - 1} y={top - 3} width={neckWidth + 2} height="4" />
  {:else}
    <!-- Sized in the drawing's units, like the rest of it, so it scales with the diagram. -->
    <text class="start" x={left - 6} y={y(start)} font-size="10" text-anchor="end" dominant-baseline="central"
      >{start}fr</text
    >
  {/if}

  {#each voicing.frets as fret, s (s)}
    {#if fret === 0}
      <circle class="open" cx={x(s)} cy={top - 10} r="4" />
    {:else if fret === null}
      <path class="muted" d="M{x(s) - 4} {top - 14}l8 8m0 -8l-8 8" />
    {/if}
  {/each}

  {#if voicing.barre}
    {@const b = voicing.barre}
    <rect
      class="finger"
      x={Math.min(x(b.from), x(b.to)) - 6}
      y={y(b.fret) - 6}
      width={(b.to - b.from) * stringGap + 12}
      height="12"
      rx="6"
    />
  {/if}
  {#each dots as d (d.string)}
    <circle class="finger" cx={x(d.string)} cy={y(d.fret)} r="6" />
  {/each}
</svg>

<style>
  .diagram {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }
  .fret,
  .string {
    stroke: var(--text-muted);
    stroke-width: 1;
  }
  .nut,
  .finger {
    fill: var(--text);
  }
  .open,
  .muted {
    fill: none;
    stroke: var(--text);
    stroke-width: 1.5;
  }
  .start {
    fill: var(--text-muted);
    font-weight: 600;
  }
</style>
