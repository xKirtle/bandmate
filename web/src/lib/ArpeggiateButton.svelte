<script lang="ts">
  // Arpeggiates a Chord: an icon button that plucks a Voicing's strings one
  // at a time, low to high. The Chord Finder puts it beside Hear.
  import ChartNoAxesColumnIncreasing from '@lucide/svelte/icons/chart-no-axes-column-increasing';
  import type { Pluck } from './chordFinder';
  import { arpeggiate } from './strum';

  let {
    chord,
    plucks,
  }: {
    /** The Chord's name, for the button's label, or "this Chord shape" for one placed in Name it that reads as none. */
    chord: string;
    /** What to pluck, low string to high: the Chord Finder's plucks. With none, as in Name it with nothing placed, it's disabled. */
    plucks: readonly Pluck[];
  } = $props();
</script>

<button
  type="button"
  class="icon"
  aria-label="Arpeggiate {chord}"
  title="Arpeggiate {chord}"
  disabled={plucks.length === 0}
  onclick={() => arpeggiate(plucks)}><ChartNoAxesColumnIncreasing /></button
>
