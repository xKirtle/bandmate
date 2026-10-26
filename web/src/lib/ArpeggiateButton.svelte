<script lang="ts">
  // Arpeggiates a Chord: an icon button that sounds a Voicing's notes one
  // at a time, low to high. The Chord Finder puts it beside Hear.
  import ChartNoAxesColumnIncreasing from '@lucide/svelte/icons/chart-no-axes-column-increasing';
  import type { HeardNote, InstrumentSound } from './chordFinder';
  import { arpeggiate } from './hear';

  let {
    chord,
    notes,
    sound,
  }: {
    /** The Chord's name, for the button's label, or "this Chord shape" for one placed in Name it that reads as none. */
    chord: string;
    /** What to sound, low to high: the Chord Finder's heardNotes. With none, as in Name it with nothing placed, it's disabled. */
    notes: readonly HeardNote[];
    /** How the Instrument sounds: which samples it plays, or the guitar's pluck. */
    sound: InstrumentSound;
  } = $props();
</script>

<button
  type="button"
  class="icon"
  aria-label="Arpeggiate {chord}"
  title="Arpeggiate {chord}"
  disabled={notes.length === 0}
  onclick={() => arpeggiate(notes, sound)}><ChartNoAxesColumnIncreasing /></button
>
