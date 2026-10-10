<script lang="ts">
  // Hears a Chord: an icon button that strums a Voicing's pitches once.
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import { strum } from './strum';

  let {
    chord,
    pitches,
  }: {
    /** The Chord's name, for the button's label. */
    chord: string;
    /** The pitches to strum, as MIDI note numbers, low string to high (see the Chord Finder's sounds). */
    pitches: readonly number[];
  } = $props();
</script>

<button type="button" class="icon" aria-label="Hear {chord}" title="Hear {chord}" onclick={() => strum(pitches)}
  ><Volume2 /></button
>
