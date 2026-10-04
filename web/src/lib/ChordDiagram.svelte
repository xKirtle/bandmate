<script lang="ts">
  // Draws a guitar Voicing as a chord diagram: the strings upright, the low
  // string on the left, the nut (or the fret the Voicing starts at, up the
  // neck) at the top. Above it, ○ marks a string that rings open and × one
  // that's muted. With a capo on, frets count from it: it's drawn as the nut,
  // and labelled under the diagram. On a left-handed device it's mirrored,
  // the low string on the right. "How to play a Chord" on the Lyric Sheet is
  // to reuse it.
  import type { Voicing } from './chordFinder';
  import { leftHanded } from './sharedLeftHanded.svelte';

  let { voicing, name, capo = 0 }: { voicing: Voicing; name: string; capo?: number } = $props();

  /** How many frets the diagram shows. A Voicing spans four at most. */
  const rows = 5;
  const stringGap = 16;
  const fretGap = 20;
  /** Room on the left for the starting fret, and above for the open and muted marks. */
  const left = 22;
  const top = 20;
  const right = 10;
  /** Room below, and more for the capo's label. */
  const bottom = $derived(capo > 0 ? 20 : 6);

  const strings = $derived(voicing.frets.length);
  /** From the low string to the high one. */
  const neckWidth = $derived((strings - 1) * stringGap);
  const width = $derived(left + neckWidth + right);
  const height = $derived(top + rows * fretGap + bottom);

  /**
   * The fret the diagram's first row is: 1, under the nut, for a Voicing that
   * fits there, else the lowest fret the Voicing presses.
   */
  const start = $derived.by(() => {
    const fretted = voicing.frets.filter((f): f is number => f !== null && f > 0);
    return fretted.length === 0 || Math.max(...fretted) <= rows ? 1 : Math.min(...fretted);
  });

  /**
   * Where a string is drawn, counted from the low one: mirrored for a
   * left-handed player. The neck's edges are left and left + neckWidth,
   * whichever way it's drawn, never x(0).
   */
  const x = (string: number) => left + (leftHanded.on ? strings - 1 - string : string) * stringGap;
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

  /** Read out low string to high, e.g. "C: x 3 2 0 1 0", starting at fret 5 up the neck, with capo 2. */
  const label = $derived(
    `${name}: ${voicing.frets.map((f) => (f === null ? 'x' : f)).join(' ')}` +
      (start > 1 ? `, from fret ${start}` : '') +
      (capo > 0 ? `, capo ${capo}` : ''),
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
  {#if start === 1 && capo > 0}
    <rect class="capo" x={left - 5} y={top - 4} width={neckWidth + 10} height="6" rx="3" />
  {:else if start === 1}
    <rect class="nut" x={left - 1} y={top - 3} width={neckWidth + 2} height="4" />
  {:else}
    <text class="start" x={left - 6} y={y(start)} text-anchor="end" dominant-baseline="central">{start}fr</text>
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

  {#if capo > 0}
    <text class="capo-label" x={left + neckWidth / 2} y={top + rows * fretGap + 14} text-anchor="middle">
      Capo {capo}
    </text>
  {/if}
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
  .capo,
  .finger {
    fill: var(--text);
  }
  .open,
  .muted {
    fill: none;
    stroke: var(--text);
    stroke-width: 1.5;
  }
  .start,
  .capo-label {
    fill: var(--text-muted);
    font-size: 10px;
    font-weight: 600;
  }
</style>
