<script lang="ts">
  import { onMount } from 'svelte';
  import Dialog from './Dialog.svelte';
  import KeyLabels from './KeyLabels.svelte';
  import { keyboardAndMouse } from './keyHints';
  import { settingsTabHref } from './nav';
  import { platform } from './shortcuts';
  import { rebound, withKeys } from './shortcutKeys';
  import { listGroups, searchGroups } from './shortcutList';
  import ShortcutSearch from './ShortcutSearch.svelte';

  // Every Shortcut on the Song page, in its group, with its keys as
  // rebound on this device, as this platform names them. All are listed
  // wherever they work, e.g. Sync mode's
  // while it's off: each says where. A search at the top narrows them down
  // by name, what they do, where they work or key, and Change keys beside
  // it leads to Settings' Shortcuts tab, which isn't shown on a phone or a
  // narrow window, so neither is the link.
  let { onClose }: { onClose: () => void } = $props();

  const uid = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let search = $state<HTMLInputElement>();
  let query = $state('');
  const all = $derived(listGroups(withKeys(rebound()), platform()));
  const groups = $derived(searchGroups(all, query));

  // The cursor starts in the search, to type straight away. The page's
  // Shortcuts stand aside while a dialog is open, so Space types a space.
  onMount(() => search?.focus());

  // A search field's Esc would clear it first, on Chrome. Here Esc closes
  // the dialog at once, as it does from anywhere else in it.
  function onkeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    dialog?.close();
  }
</script>

<Dialog
  bind:dialog
  title="Keyboard shortcuts"
  dismissible={() => true}
  onclose={onClose}
  fill
  --dialog-width="40rem"
  --dialog-height="min(48rem, calc(100dvh - 2rem))"
  --dialog-gap="var(--space-4)"
>
  <div class="top">
    <ShortcutSearch bind:value={query} bind:input={search} {onkeydown} />
    {#if keyboardAndMouse()}
      <a class="button" href={settingsTabHref('shortcuts')}>Change keys</a>
    {/if}
  </div>
  <!-- Its own scroll, so the search stays put as the list scrolls and
       narrows. Tab reaches it, for arrows and Space to scroll it, since
       nothing in it takes focus. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="results" role="region" aria-label="Shortcuts" tabindex="0">
    {#each groups as { group, rows }, g (group)}
      <section aria-labelledby="{uid}-group-{g}">
        <h3 id="{uid}-group-{g}">{group}</h3>
        <ul>
          {#each rows as row (row.name)}
            <li>
              <div class="what">
                <span class="name">{row.name}</span>
                <span class="muted">{row.description} {row.worksIn}</span>
              </div>
              <KeyLabels keys={row.keys} />
            </li>
          {/each}
        </ul>
      </section>
    {:else}
      <p class="muted">No Shortcuts match.</p>
    {/each}
  </div>
</Dialog>

<style>
  .top {
    display: flex;
    gap: var(--space-2);
  }
  .results {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-4);
    min-height: 0;
    overflow: auto;
  }
  .results > p {
    margin: 0;
  }
  h3 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-md);
    color: var(--text-muted);
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
  .what .muted {
    font-size: var(--text-md);
  }
</style>
