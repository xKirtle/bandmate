<script lang="ts">
  // Hears a Chord: an icon button that strums a Voicing once.
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import type { Pluck } from './chordFinder';
  import { strum } from './strum';

  let {
    chord,
    plucks,
  }: {
    /** The Chord's name, for the button's label, or "this Chord shape" for one placed in Name it that reads as none. */
    chord: string;
    /** What to strum, low string to high: the Chord Finder's plucks. With none, as in Name it with nothing placed, it's disabled. */
    plucks: readonly Pluck[];
  } = $props();
</script>

<button
  type="button"
  class="icon"
  aria-label="Hear {chord}"
  title="Hear {chord}"
  disabled={plucks.length === 0}
  onclick={() => strum(plucks)}><Volume2 /></button
>
