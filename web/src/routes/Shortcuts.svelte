<script lang="ts">
  // Settings' Shortcuts tab: every Shortcut on the Song page, in its group's
  // card, each a fold showing its name, whether it's changed or new, and its
  // keys as rebound on this device, and opening to what it does, where it
  // works and its keys to change (KeysEditor).
  // The same search as the shortcuts dialog's narrows them down, and Reset
  // to defaults beside it puts every Shortcut back. Shortcuts are for a
  // keyboard and mouse, so a phone or a narrow window opens This device at
  // its address instead (see nav.ts).
  import { tick } from 'svelte';
  import FoldChevron from '../lib/FoldChevron.svelte';
  import KeyLabels from '../lib/KeyLabels.svelte';
  import KeysEditor from '../lib/KeysEditor.svelte';
  import SettingsPage from '../lib/SettingsPage.svelte';
  import { shortcutKeys } from '../lib/sharedShortcutKeys.svelte';
  import { platform } from '../lib/shortcuts';
  import { anyChanged, defaultShortcutKeys, isChanged, seen, withKeys, type ShortcutId } from '../lib/shortcutKeys';
  import { listGroups, searchGroups } from '../lib/shortcutList';
  import ShortcutSearch from '../lib/ShortcutSearch.svelte';

  const uid = $props.id();
  let query = $state('');
  const all = $derived(listGroups(withKeys(shortcutKeys.value.keys), platform()));
  const groups = $derived(searchGroups(all, query));
  /** The Shortcuts whose folds are open, kept as the search hides and shows them. */
  let opened = $state<ReadonlySet<string>>(new Set());

  function toggled(id: ShortcutId, open: boolean) {
    if (open === opened.has(id)) return;
    const next = new Set(opened);
    if (open) next.add(id);
    else next.delete(id);
    opened = next;
    // A new Shortcut is new until its fold is opened.
    if (open && shortcutKeys.value.fresh.includes(id)) shortcutKeys.set(seen(shortcutKeys.value, id));
  }

  // Opens the fold of the Shortcut that has a key refused, to free it
  // there, showing it first if the search hides it.
  async function reveal(id: ShortcutId) {
    if (!groups.some((g) => g.rows.some((r) => r.id === id))) query = '';
    toggled(id, true);
    await tick();
    const fold = document.getElementById(`${uid}-${id}`);
    fold?.scrollIntoView({ block: 'center' });
    fold?.querySelector('summary')?.focus({ preventScroll: true });
  }
</script>

<SettingsPage tab="shortcuts">
  <p class="kept hint">Kept on this device. Each key does one thing, anywhere on a Song page.</p>
  <div class="top">
    <ShortcutSearch bind:value={query} />
    <button
      type="button"
      class="button"
      disabled={!anyChanged(shortcutKeys.value)}
      onclick={() => shortcutKeys.set(defaultShortcutKeys)}>Reset to defaults</button
    >
  </div>
  <div class="cards">
    {#each groups as { group, rows }, g (group)}
      <section class="card" aria-labelledby="{uid}-group-{g}">
        <h2 id="{uid}-group-{g}">{group}</h2>
        {#each rows as row (row.id)}
          {@const id = row.id as ShortcutId}
          {@const fresh = shortcutKeys.value.fresh.includes(id)}
          <details id="{uid}-{id}" open={opened.has(id)} ontoggle={(e) => toggled(id, e.currentTarget.open)}>
            <summary>
              <FoldChevron />
              <span class="name">{row.name}</span>
              {#if fresh}
                <span class="badge new">New</span>
              {:else if isChanged(shortcutKeys.value.keys, id)}
                <span class="hint">Changed</span>
              {/if}
              <KeyLabels keys={row.keys} />
            </summary>
            <div class="body">
              <p>{row.description}</p>
              <p class="hint">{row.worksIn}</p>
              {#if opened.has(id)}
                <KeysEditor {id} onreveal={reveal} />
              {/if}
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
  .top {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
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
  .new {
    background: var(--accent);
    color: var(--accent-text);
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
  .body :global(.editor) {
    margin-top: var(--space-2);
  }
</style>
