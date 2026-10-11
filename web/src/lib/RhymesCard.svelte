<script lang="ts">
  // The Rhymes card, in the Song page's side column on desktop: Rhymes for
  // the word at the caret of the Line being written, or for any word typed
  // into its field. The page decides the word; typing here changes it until
  // the caret moves in a Line again.
  import type { Rhymes } from './lyricsLanguage';
  import RhymeGroups from './RhymeGroups.svelte';

  let {
    word,
    setWord,
    rhymes,
    loading,
    noRhymesIn,
  }: {
    /** The word Rhymes are for, or null while there's none. */
    word: string | null;
    /** Looks up Rhymes for a word typed, or for none once the field's empty. */
    setWord: (word: string | null) => void;
    rhymes: Rhymes | null;
    /** Whether the Language's data is still on its way. */
    loading: boolean;
    /** The Song's Languages, named, when Bandmate suggests Rhymes in none of them. */
    noRhymesIn: string | null;
  } = $props();
</script>

<section class="rhymes" aria-label="Rhymes">
  <label class="field">
    Rhymes for
    <input
      type="search"
      value={word ?? ''}
      oninput={(e) => setWord(e.currentTarget.value.trim() || null)}
      placeholder="Type a word"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
  </label>
  <div class="results">
    <RhymeGroups {word} {rhymes} {loading} {noRhymesIn} limit={60} />
  </div>
</section>

<style>
  .rhymes {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  /* Scrolls on its own, so a word with many Rhymes leaves room for the
     Scrapbook beneath. */
  .results {
    max-height: calc(6 * var(--control));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
