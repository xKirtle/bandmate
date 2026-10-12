<script lang="ts">
  // The Rhymes card, in the Song page's side column on desktop: Rhymes for
  // the word at the caret of the Line being written, or for any word typed
  // into its field. The page decides the word; typing here changes it until
  // the caret moves in a Line again. In a Song of several Languages, tabs
  // switch among them, starting at the one the word is read in. One whose
  // dictionary isn't set up on this device shows a link to set it up in
  // Settings in place of Rhymes.
  import { languageName } from './languages';
  import type { RhymeLookup } from './rhymeLookup';
  import RhymeGroups from './RhymeGroups.svelte';

  let {
    lookup,
    setWord,
    languages,
    pickLanguage,
  }: {
    lookup: RhymeLookup;
    /** Looks up Rhymes for a word typed, or for none once the field's empty. */
    setWord: (word: string | null) => void;
    /** The Song's Languages, in its order. */
    languages: readonly string[];
    /** Looks up the word's Rhymes in another of the Song's Languages. */
    pickLanguage: (code: string) => void;
  } = $props();

  // There's a switch only when there's a word, in a Song of several Languages.
  const switching = $derived(lookup.word !== null && languages.length > 1);
  let tabButtons = $state<HTMLButtonElement[]>([]);

  function tabKey(e: KeyboardEvent, i: number) {
    const moves: Record<string, number> = {
      ArrowRight: (i + 1) % languages.length,
      ArrowLeft: (i - 1 + languages.length) % languages.length,
      Home: 0,
      End: languages.length - 1,
    };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    pickLanguage(languages[to]);
    tabButtons[to]?.focus();
  }
</script>

<section class="rhymes" aria-label="Rhymes">
  <label class="field">
    Rhymes for
    <input
      type="search"
      value={lookup.word ?? ''}
      oninput={(e) => setWord(e.currentTarget.value.trim() || null)}
      placeholder="Type a word"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
  </label>
  {#if switching}
    <div class="tabs" role="tablist" aria-label="Rhymes in">
      {#each languages as code, i (code)}
        <button
          bind:this={tabButtons[i]}
          id="rhymes-tab-{code}"
          type="button"
          role="tab"
          aria-selected={lookup.language === code}
          aria-controls="rhymes-panel"
          tabindex={lookup.language === code || (!lookup.language && i === 0) ? 0 : -1}
          onclick={() => pickLanguage(code)}
          onkeydown={(e) => tabKey(e, i)}
        >
          {languageName(code)}
        </button>
      {/each}
    </div>
  {/if}
  <div
    class="results"
    id="rhymes-panel"
    role={switching ? 'tabpanel' : undefined}
    aria-labelledby={switching && lookup.language ? `rhymes-tab-${lookup.language}` : undefined}
  >
    <RhymeGroups {lookup} limit={60} />
  </div>
</section>

<style>
  .rhymes {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .tabs {
    border-bottom: 1px solid var(--border);
  }
  /* Scrolls on its own, so a word with many Rhymes leaves room for the
     Scrapbook beneath. */
  .results {
    max-height: calc(6 * var(--control));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
