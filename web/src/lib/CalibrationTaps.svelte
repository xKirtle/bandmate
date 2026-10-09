<script lang="ts">
  import { formatOffset, steadyOver, type Tap } from './calibration';

  // Draws a calibration's taps as they're heard: a dot for each tap's delay,
  // in the order tapped, later delays higher, and the average they make as a
  // line across. A tap left out of the average is a hollow, muted ring, so a
  // stray stands out and the taps can be seen to level out.
  let { taps, average }: { taps: readonly Tap[]; average: number | null } = $props();

  let width = $state(0);
  let height = $state(0);

  // The drawing's own sizes, in pixels: a dot's radius, and the room kept
  // round the edge so a dot there isn't cut off.
  const dot = 4;
  const inset = dot + 2;
  // The least span of delays shown, in seconds, so a few taps that agree
  // closely don't look scattered; and the room above and below them.
  const leastSpan = 0.02;
  const margin = 0.005;
  // How many taps the width holds before it squeezes them closer.
  const leastSlots = 2 * steadyOver;

  const delays = $derived([...taps.map((t) => t.delay), ...(average === null ? [] : [average])]);
  const range = $derived.by(() => {
    if (delays.length === 0) return { low: 0, high: leastSpan };
    let low = Math.min(...delays) - margin;
    let high = Math.max(...delays) + margin;
    const short = leastSpan - (high - low);
    if (short > 0) [low, high] = [low - short / 2, high + short / 2];
    return { low, high };
  });
  const x = (i: number) => inset + (i * (width - 2 * inset)) / Math.max(1, Math.max(taps.length, leastSlots) - 1);
  const y = (delay: number) => height - inset - ((delay - range.low) / (range.high - range.low)) * (height - 2 * inset);
  const left = $derived(taps.filter((t) => !t.counted).length);
  const label = $derived(
    `Each tap's delay: ${taps.length} ${taps.length === 1 ? 'tap' : 'taps'}` +
      (left ? `, ${left} left out of the average` : '') +
      (average === null ? '' : `, averaging ${formatOffset(average)}`),
  );
</script>

<div class="taps" bind:clientWidth={width} bind:clientHeight={height}>
  <svg {width} {height} role="img" aria-label={label}>
    {#if width > 0}
      {#if average !== null}
        <line class="average" x1={inset} x2={width - inset} y1={y(average)} y2={y(average)} />
      {/if}
      {#each taps as tap, i (i)}
        <circle class={tap.counted ? 'counted' : 'left'} cx={x(i)} cy={y(tap.delay)} r={dot}>
          <title>Tap {i + 1}: {formatOffset(tap.delay)}{tap.counted ? '' : ', left out'}</title>
        </circle>
      {/each}
    {/if}
  </svg>
</div>

<style>
  .taps {
    height: var(--tap-graph);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
  }
  svg {
    display: block;
  }
  .average {
    stroke: var(--text);
    stroke-width: 2;
    stroke-dasharray: 6 4;
  }
  .counted {
    fill: var(--accent);
    stroke: var(--surface-1);
    stroke-width: 1;
  }
  .left {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.5;
  }
</style>
