<script lang="ts">
  // Hears a Chord: an icon button that sounds a Voicing once, as its
  // Instrument sounds it: strummed, as the guitar, or its notes together, as
  // the piano.
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import type { HeardNote, InstrumentSound } from './chordFinder';
  import { hear } from './hear';

  let {
    chord,
    notes,
    sound,
  }: {
    /** The Chord's name, for the button's label, or "this Chord shape" for one placed in Name it that reads as none. */
    chord: string;
    /** What to hear, low to high: the Chord Finder's heardNotes. With none, as in Name it with nothing placed, it's disabled. */
    notes: readonly HeardNote[];
    /** How the Instrument sounds: which samples it plays, strummed low to high or its notes together. */
    sound: InstrumentSound;
  } = $props();
</script>

<button
  type="button"
  class="icon"
  aria-label="Hear {chord}"
  title="Hear {chord}"
  disabled={notes.length === 0}
  onclick={() => hear(notes, sound)}><Volume2 /></button
>
