<script lang="ts">
  // Hears a Chord: an icon button that strums a Voicing once, or, on an
  // Instrument that isn't strummed, as the piano, sounds its notes together.
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import type { Pluck } from './chordFinder';
  import { strum, together } from './strum';

  let {
    chord,
    plucks,
    strummed = true,
  }: {
    /** The Chord's name, for the button's label, or "this Chord shape" for one placed in Name it that reads as none. */
    chord: string;
    /** What to hear, low to high: the Chord Finder's plucks. With none, as in Name it with nothing placed, it's disabled. */
    plucks: readonly Pluck[];
    /** Whether to strum them, low to high, as on the guitar, or sound them together, as on the piano. */
    strummed?: boolean;
  } = $props();
</script>

<button
  type="button"
  class="icon"
  aria-label="Hear {chord}"
  title="Hear {chord}"
  disabled={plucks.length === 0}
  onclick={() => (strummed ? strum(plucks) : together(plucks))}><Volume2 /></button
>
