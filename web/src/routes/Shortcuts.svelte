<script lang="ts">
  // Settings' Shortcuts tab: every Shortcut on the Song page, in its group's
  // card, each a fold showing its name and keys, and opening to what it
  // does and where it works. The same search as the shortcuts dialog's
  // narrows them down. Shortcuts are for a keyboard and mouse, so a phone or
  // a narrow window opens This device at its address instead (see nav.ts).
  import FoldChevron from '../lib/FoldChevron.svelte';
  import KeyLabels from '../lib/KeyLabels.svelte';
  import SettingsPage from '../lib/SettingsPage.svelte';
  import { platform, shortcuts } from '../lib/shortcuts';
  import { listGroups, searchGroups } from '../lib/shortcutList';
  import ShortcutSearch from '../lib/ShortcutSearch.svelte';

  const uid = $props.id();
  let query = $state('');
  const all = listGroups(shortcuts, platform());
  const groups = $derived(searchGroups(all, query));
</script>

<SettingsPage tab="shortcuts">
  <p class="kept hint">Kept on this device. Each key does one thing, anywhere on a Song page.</p>
  <div class="search">
    <ShortcutSearch bind:value={query} />
  </div>
  <div class="cards">
    {#each groups as { group, rows }, g (group)}
      <section class="card" aria-labelledby="{uid}-group-{g}">
        <h2 id="{uid}-group-{g}">{group}</h2>
        {#each rows as row (row.name)}
          <details>
            <summary>
              <FoldChevron />
              <span class="name">{row.name}</span>
              <KeyLabels keys={row.keys} />
            </summary>
            <div class="body">
              <p>{row.description}</p>
              <p class="hint">{row.worksIn}</p>
            </div>
          </details>
        {/each}
      </section>
    {:else}
      <p class="hint">No Shortcuts match.</p>
    {/each}
  </div>
</SettingsPage>

<style>
  .kept {
    margin: 0 0 var(--space-4);
  }
  .search {
    display: flex;
    margin-bottom: var(--space-4);
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .cards > p {
    margin: 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    padding: var(--space-2) var(--space-4);
  }
  h2 {
    margin: var(--space-2) 0;
    font-size: var(--text-lg);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  details {
    /* As wide as FoldChevron's icon, which is as big as the text it's in. */
    --chevron-width: 1em;
    border-top: 1px solid var(--border);
  }
  summary {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    cursor: pointer;
  }
  .name {
    flex: 1;
    font-weight: 600;
  }
  /* What it does lines up with the name, past the chevron. */
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 0 var(--space-3) calc(var(--chevron-width) + var(--space-2));
  }
  .body p {
    margin: 0;
  }
</style>
