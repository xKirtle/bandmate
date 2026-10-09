<script lang="ts" module>
  import type { Tap } from './calibration';

  /** A tap, with when it was heard, by performance.now(). */
  export type Mark = Tap & { at: number };
</script>

<script lang="ts">
  import { formatOffset } from './calibration';
  import { arcReach, armAngle, beatAt, markAngle, markFade } from './metronome';

  // Calibration's metronome: an arm that swings upright, past a dotted
  // centre line, as each click is heard, so the beat can be seen coming
  // rather than reacted to. It follows the clicks as the browser says
  // they're heard, never the offset being measured, so a tapper's bias
  // can't feed back into what they tap to. Each tap shows as a mark on the
  // arc as it's heard, placed by its delay from the average and magnified,
  // later to the right; one left out of the average is hollow. Marks fade
  // after a few seconds. It tracks real time, so it keeps moving under
  // reduced motion, as a level meter does.
  let {
    from,
    heard,
    marks,
    average,
  }: {
    /** The context time clicks are scheduled from, while they play; null while they don't, leaving the arm upright. */
    from: number | null;
    /** The context time being heard now. */
    heard: () => number;
    /** Each tap, with when it was heard. */
    marks: readonly Mark[];
    /** The average the marks are placed by, in seconds; null with none. */
    average: number | null;
  } = $props();

  // The drawing's own units: the pivot, near the bottom middle, and the arc's radius.
  const pivot = { x: 150, y: 190 };
  const radius = 170;

  let beat = $state(Number.NaN);
  let now = $state(0);

  $effect(() => {
    let frame = 0;
    const step = (time: number) => {
      now = time;
      beat = from === null ? Number.NaN : beatAt(heard(), from);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  });

  const swinging = $derived(Number.isFinite(beat));
  // Faint until the first click is nearly heard.
  const ready = $derived(!swinging || beat < -0.5);
  const angle = $derived(swinging ? armAngle(beat) : 0);
  // The top of the centre line lights as the arm passes it.
  const passing = $derived(swinging && beat > -0.5 ? Math.max(0, 1 - Math.abs(beat - Math.round(beat)) * 8) : 0);

  /** A point on a circle round the pivot, at an angle from upright, in degrees. */
  function at(degrees: number, r: number) {
    const a = ((degrees - 90) * Math.PI) / 180;
    return { x: pivot.x + Math.cos(a) * r, y: pivot.y + Math.sin(a) * r };
  }
  const arcFrom = at(-arcReach, radius);
  const arcTo = at(arcReach, radius);

  const shown = $derived(
    marks
      .map((mark) => ({ ...mark, fade: markFade((now - mark.at) / 1000) }))
      .filter((mark) => mark.fade > 0 && average !== null),
  );
  const label = $derived(
    `Metronome, upright as each click is heard` +
      (shown.length ? `, with ${shown.length} ${shown.length === 1 ? 'tap' : 'taps'} marked around the average` : ''),
  );
</script>

<svg class="metronome" viewBox="0 0 300 200" role="img" aria-label={label}>
  <path class="arc" d="M {arcFrom.x} {arcFrom.y} A {radius} {radius} 0 0 1 {arcTo.x} {arcTo.y}" />
  <line class="centre" x1={pivot.x} y1={pivot.y} x2={pivot.x} y2={pivot.y - radius - 6} />
  <line
    class="top"
    x1={pivot.x}
    y1={pivot.y - radius - 14}
    x2={pivot.x}
    y2={pivot.y - radius + 2}
    opacity={0.3 + passing * 0.7}
  />
  {#each shown as mark, i (i)}
    {@const p = at(markAngle(mark.delay, average ?? 0), radius)}
    <circle class={mark.counted ? 'counted' : 'left-out'} cx={p.x} cy={p.y} r="5" opacity={mark.fade}>
      <title>{formatOffset(mark.delay)}{mark.counted ? '' : ', left out'}</title>
    </circle>
  {/each}
  <g transform="rotate({angle} {pivot.x} {pivot.y})" class:ready>
    <line class="arm" x1={pivot.x} y1={pivot.y} x2={pivot.x} y2={pivot.y - radius} />
    <circle class="weight" cx={pivot.x} cy={pivot.y - 110} r="9" />
  </g>
  <circle class="pivot" cx={pivot.x} cy={pivot.y} r="6" />
</svg>

<style>
  .metronome {
    display: block;
    width: 100%;
    height: var(--metronome);
  }
  .arc {
    fill: none;
    stroke: var(--border);
    stroke-width: 2;
  }
  .centre {
    stroke: var(--text-muted);
    stroke-width: 1.5;
    stroke-dasharray: 4 4;
  }
  .top {
    stroke: var(--accent);
    stroke-width: 4;
    stroke-linecap: round;
  }
  .arm {
    stroke: var(--text);
    stroke-width: 4;
    stroke-linecap: round;
  }
  .ready {
    opacity: 0.35;
  }
  .weight,
  .pivot {
    fill: var(--text);
  }
  .counted {
    fill: var(--accent);
  }
  .left-out {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1.5;
  }
</style>
