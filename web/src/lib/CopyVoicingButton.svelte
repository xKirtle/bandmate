<script lang="ts">
  // Copies a guitar Voicing as a Song Voicing: an icon button that puts the
  // Chord's name and the Voicing's frets on the clipboard in their brackets,
  // ready to paste into a Line in Write mode ("[Em:x-0-9-9-x-x]"). Beside it,
  // a word says it was copied, or that the browser didn't allow it. The
  // Chord Finder puts it beside Hear and Arpeggiate, on the guitar only.
  import Copy from '@lucide/svelte/icons/copy';
  import { copyText } from './copyText';
  import type { Frets } from './guitar';
  import { chordWithSongVoicing } from './writtenChord';

  let {
    chord,
    frets,
  }: {
    /** The Chord's name, as the Chord Finder shows it. */
    chord: string;
    /** The Voicing's frets, low string to high, in the tuning picked in the Chord Finder. */
    frets: Frets;
  } = $props();

  const text = $derived(chordWithSongVoicing(chord, frets));

  let status = $state<'copied' | 'failed' | null>(null);
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    clearTimeout(statusTimer);
    status = (await copyText(text)) ? 'copied' : 'failed';
    if (status === 'copied') statusTimer = setTimeout(() => (status = null), 2000);
  }

  $effect(() => () => clearTimeout(statusTimer));
</script>

<span class="copy">
  <button
    type="button"
    class="icon"
    aria-label="Copy {text} as a Song Voicing"
    title="Copy {text}, to paste into a Line in Write mode"
    onclick={copy}><Copy /></button
  >
  <span class="status" class:muted={status === 'copied'} class:error={status === 'failed'} role="status">
    {#if status === 'copied'}Copied{:else if status === 'failed'}Couldn't copy{/if}
  </span>
</span>

<style>
  .copy {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .status {
    font-size: var(--text-sm);
  }
  .status:empty {
    display: none;
  }
</style>
