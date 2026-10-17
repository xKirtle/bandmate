<script lang="ts">
  // PROTOTYPE, throwaway: variant A's Shortcuts card, the last on This device:
  // search, each group a subtitle, every row rebound in place.
  import { changedCount, grouped, resetAll } from './engine.svelte';
  import KeysEditor from './KeysEditor.svelte';

  let query = $state('');
  const groups = $derived(grouped(query));
  const slug = (g: string) => 'shortcuts-' + g.toLowerCase().replace(/[^a-z]+/g, '-');
</script>

<section class="card" id="shortcuts" aria-labelledby="shortcuts-heading">
  <div class="head">
    <h2 id="shortcuts-heading">Shortcuts</h2>
    <button type="button" class="button quiet" disabled={changedCount() === 0} onclick={resetAll}
      >Reset to defaults</button
    >
  </div>
  <p class="hint">
    The keys used on a Song page. Click a key, then press the one you want; Esc cancels. Each key does one thing.
  </p>
  <input class="field" type="search" placeholder="Search by name or key, e.g. Record or Shift" bind:value={query} />
  {#each groups as { group, entries } (group)}
    <!-- Subtitles stay in the outline while searching; their ids don't move. -->
    <div class="group">
      <h3 id={slug(group)}>{group}</h3>
      <ul>
        {#each entries as entry (entry.id)}
          <li>
            <div class="what">
              <span class="name">{entry.name}</span>
              <span class="hint">{entry.description}</span>
            </div>
            <KeysEditor {entry} />
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <p class="hint">No Shortcuts match.</p>
  {/each}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  h3 {
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-md);
  }
  p {
    margin: 0;
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-1) var(--space-4);
    padding: var(--space-2) 0;
    border-top: 1px solid var(--border);
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .name {
    font-weight: 600;
  }
</style>
