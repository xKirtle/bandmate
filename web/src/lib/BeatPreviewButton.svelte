<script lang="ts">
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';

  // A Beat's preview button in a list with no waveform to tell the previewed
  // Beat by: the Beat Library's table, its staged rows, and the Beat Picker.
  // The previewed Beat's sits on an accent circle, like the round play button
  // of the Library's cards, playing or paused, until another Beat is
  // previewed or the preview is put away.
  let {
    name,
    playing,
    previewed,
    accent = false,
    onclick,
  }: {
    /** What it previews, as its label names it, e.g. `Echo Room` or `“track_07.wav”`. */
    name: string;
    playing: boolean;
    previewed: boolean;
    /** Its icon in the accent while it isn't previewed, as the Beat Picker has it. */
    accent?: boolean;
    onclick: () => void;
  } = $props();
</script>

<button
  type="button"
  class="icon preview"
  class:accent
  class:previewed
  aria-label="{playing ? 'Pause' : 'Preview'} {name}"
  {onclick}
>
  {#if playing}<Pause />{:else}<Play />{/if}
</button>

<style>
  .preview {
    flex-shrink: 0;
  }
  .accent {
    color: var(--accent);
  }
  .previewed {
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-text);
  }
  /* Solid, to stand out on the accent. */
  .previewed :global(.lucide-icon) {
    fill: currentColor;
  }
  @media (hover: hover) {
    .accent:hover:not(:disabled) {
      color: var(--accent);
    }
    .previewed:hover:not(:disabled) {
      border-color: transparent;
      background: color-mix(in srgb, var(--accent) 85%, var(--text));
      color: var(--accent-text);
    }
  }
</style>
