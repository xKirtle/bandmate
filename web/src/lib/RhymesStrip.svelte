<script lang="ts">
  // The Rhymes strip, docked at the bottom of a window narrower than the
  // desktop's while a Line has focus: one row of Rhymes for the word at the
  // caret, scrolled sideways. It sits above the docked Timeline and the
  // navigation, or above the on-screen keyboard while that's up. Pressing
  // on it leaves focus in the Line, so the keyboard stays up and the strip
  // stays. In a Song of several Languages, they're in the one the word is
  // read in.
  import type { RhymeLookup } from './rhymeLookup';
  import RhymeGroups from './RhymeGroups.svelte';
  import { keyboardInset } from './keyboardInset.svelte';

  let {
    lookup,
    timelineHeight,
  }: {
    lookup: RhymeLookup;
    /** How tall the docked Timeline is, in pixels, to sit above it. */
    timelineHeight: number;
  } = $props();

  const word = $derived(lookup.word);
</script>

<aside
  class="strip"
  aria-label={word ? `Rhymes for “${word}”` : 'Rhymes'}
  style:--timeline-height="{timelineHeight}px"
  style:--keyboard-inset="{keyboardInset()}px"
  onpointerdown={(e) => e.preventDefault()}
>
  {#if word}<strong class="word">{word}</strong>{/if}
  <RhymeGroups {lookup} row limit={40} />
</aside>

<style>
  .strip {
    position: fixed;
    right: 0;
    bottom: max(var(--keyboard-inset), calc(var(--nav-bottom-space) + var(--timeline-height)));
    left: 0;
    z-index: 2;
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    min-height: var(--control);
    padding: var(--space-2) max(var(--gutter), env(safe-area-inset-right)) var(--space-2)
      max(var(--gutter), env(safe-area-inset-left));
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
    border-top: 1px solid var(--border);
    background: var(--surface-1);
    white-space: nowrap;
    user-select: none;
  }
  .word {
    font-size: var(--text-md);
  }
</style>
