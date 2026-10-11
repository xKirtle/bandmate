<script lang="ts">
  // A Line's Syllable Count, muted beside it: "7", or "~7" when a word in it
  // was guessed. It's as tall as a line of the text it's beside, and centred
  // on it, so it sits on the first line of a Line that wraps. Empty for a
  // Line that gets no count. Screen readers skip it: it's for the eye, to
  // compare Lines at a glance.
  import type { SyllableCount } from './lyricsLanguage';

  let { count }: { count: SyllableCount | null } = $props();
</script>

<span class="syllables" aria-hidden="true">
  {#if count}
    <span
      class="number"
      title={count.estimate
        ? `About ${count.count} syllables: a word Bandmate doesn't know was guessed from its spelling`
        : `${count.count} ${count.count === 1 ? 'syllable' : 'syllables'}`}
      >{count.estimate ? '~' : ''}{count.count}</span
    >
  {/if}
</span>

<style>
  .syllables {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    height: 1lh;
    user-select: none;
  }
  .number {
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
