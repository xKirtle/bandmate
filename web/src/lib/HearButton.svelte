<script lang="ts">
  // Hears a Chord: an icon button that strums a Voicing once.
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import type { Pluck } from './chordFinder';
  import { strum } from './strum';

  let {
    chord,
    plucks,
  }: {
    /** The Chord's name, for the button's label. */
    chord: string;
    /** What to strum, low string to high: the Chord Finder's plucks of the Voicing. */
    plucks: readonly Pluck[];
  } = $props();
</script>

<button type="button" class="icon" aria-label="Hear {chord}" title="Hear {chord}" onclick={() => strum(plucks)}
  ><Volume2 /></button
>
