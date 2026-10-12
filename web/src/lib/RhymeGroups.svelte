<script lang="ts">
  // A word's Rhymes, perfect ones first, then near ones in a group of their
  // own, each with its Syllable Count; or why there are none, such as a
  // Language not set up on this device, with a link to set it up in
  // Settings. Rhymes guessed from the word's spelling say so. They're for
  // reference only: no Rhyme can be clicked, so one never goes into the
  // Lyric Sheet. Wrapped onto as many rows as they take.
  import { languageName } from './languages';
  import type { RhymeLookup } from './rhymeLookup';

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
  /** Languages named in a list: "English and Portuguese", or with "or". */
  const named = (codes: readonly string[], type: 'conjunction' | 'disjunction') =>
    new Intl.ListFormat('en', { type }).format(codes.map((code) => languageName(code)));
  // Where Languages are set up: Settings' Writing card.
  const settings = '/settings#writing';
</script>

{#if loading}
  <p class="muted message">Loading…</p>
{:else if toSetUp.length > 0 && notIn.length > 0}
  <p class="muted message">
    Not in {named(notIn, 'disjunction')}. <a href={settings}>Set up {named(toSetUp, 'conjunction')} in Settings</a> to look
    it up there.
  </p>
{:else if toSetUp.length > 0 && language}
  <p class="muted message">
    {languageName(language)} isn’t set up on this device. <a href={settings}>Set up in Settings</a>
  </p>
{:else if toSetUp.length > 0}
  <p class="muted message">
    Rhymes need a dictionary on this device. <a href={settings}>Set up {named(toSetUp, 'conjunction')} in Settings</a>
  </p>
{:else if !word}
  <p class="muted message">Rhymes show here for the word at the cursor as you write.</p>
{:else if !rhymes}
  <p class="muted message">No Rhymes for “{word}”: Bandmate doesn’t know how it sounds.</p>
{:else}
  {#if rhymes.guess && language}
    <p class="muted message guess">
      Guessed from its spelling: the {languageName(language)} dictionary doesn’t have “{word}”.
    </p>
  {/if}
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
  .guess {
    margin-bottom: var(--space-3);
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
