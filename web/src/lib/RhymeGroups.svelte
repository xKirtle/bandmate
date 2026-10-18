<script lang="ts">
  // A word's Rhymes, perfect ones first, then near ones in a group of their
  // own, each with its Syllable Count; or why there are none, such as a
  // Language whose dictionary isn't downloaded to this device, with a link
  // to download it in Settings, or a word the dictionary doesn't have.
  // They're for reference only: no Rhyme can be clicked, so one never
  // goes into the Lyric Sheet. Wrapped onto as many rows as they take.
  import { languageName } from './languages';
  import type { RhymeLookup } from './rhymeLookup';
  import { listedLanguages } from './sharedLanguages.svelte';

  let {
    lookup,
    limit,
  }: {
    lookup: RhymeLookup;
    /** The most of each group shown, nearest the word in syllables first. */
    limit: number;
  } = $props();

  const { word, language, rhymes, loading, toSetUp, notIn } = $derived(lookup);
  const groups = $derived(
    rhymes
      ? [
          { name: 'Perfect', list: rhymes.perfect.slice(0, limit) },
          { name: 'Near', list: rhymes.near.slice(0, limit) },
        ]
      : [],
  );
  const syllables = (n: number) => (n === 1 ? 'syllable' : 'syllables');
  /** Languages named in a list: "English and Portuguese (Portugal)", or with "or". */
  const named = (codes: readonly string[], type: 'conjunction' | 'disjunction') =>
    new Intl.ListFormat('en', { type }).format(codes.map((code) => languageName(code, listedLanguages.list)));
  /** The rhyming dictionaries to download: "the Portuguese (Portugal) rhyming dictionary", or "dictionaries" for several. */
  const dictionariesOf = (codes: readonly string[]) =>
    `the ${named(codes, 'conjunction')} rhyming ${codes.length === 1 ? 'dictionary' : 'dictionaries'}`;
  // Where rhyming dictionaries are downloaded: Settings' Rhyming dictionaries card.
  const settings = '/settings#rhyming-dictionaries';
</script>

{#if loading}
  <p class="muted message">Loading…</p>
{:else if toSetUp.length > 0 && notIn.length > 0}
  <p class="muted message">
    Not in {named(notIn, 'disjunction')}.
    <span class="action"
      ><a href={settings}>Download {dictionariesOf(toSetUp)} in Settings</a> to look it up there.</span
    >
  </p>
{:else if toSetUp.length > 0 && language}
  <p class="muted message">
    {languageName(language, listedLanguages.list)} isn’t downloaded on this device.
    <a class="action" href={settings}>Download it in Settings</a>
  </p>
{:else if toSetUp.length > 0}
  <p class="muted message">
    Rhymes need a dictionary on this device.
    <a class="action" href={settings}>Download {dictionariesOf(toSetUp)} in Settings</a>
  </p>
{:else if !word}
  <p class="muted message">Rhymes show here for the word at the cursor as you write.</p>
{:else if !rhymes}
  <p class="muted message">
    No Rhymes: “{word}” isn’t in the {language ? `${languageName(language, listedLanguages.list)} ` : ''}dictionary.
  </p>
{:else}
  <div class="groups">
    {#each groups as { name, list } (name)}
      <div class="group">
        <h3 class="name">{name}</h3>
        {#if list.length > 0}
          <ul>
            {#each list as rhyme (rhyme.word)}
              <li>
                {rhyme.word}
                <span class="count">{rhyme.count}<span class="visually-hidden"> {syllables(rhyme.count)}</span></span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted none">None</p>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .message {
    margin: 0;
    font-size: var(--text-sm);
  }
  /* What to do about the message, on a line of its own. */
  .action {
    display: block;
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .name {
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    font-size: var(--text-md);
    white-space: nowrap;
  }
  .count {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .none {
    margin: 0;
    font-size: var(--text-md);
  }
</style>
