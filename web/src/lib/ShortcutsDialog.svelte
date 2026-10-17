<script lang="ts">
  import { onMount } from 'svelte';
  import Dialog from './Dialog.svelte';
  import { platform, shortcuts } from './shortcuts';
  import { dialogGroups, searchGroups } from './shortcutsDialog';

  // Every Shortcut on the Song page, in its group, with its keys as this
  // platform names them. All are listed wherever they work, e.g. Sync mode's
  // while it's off: each group's heading says where. A search at the top
  // narrows them down by name, description or key.
  let { onClose }: { onClose: () => void } = $props();

  const uid = $props.id();
  let dialog = $state<HTMLDialogElement>();
  let search = $state<HTMLInputElement>();
  let query = $state('');
  const all = dialogGroups(shortcuts, platform());
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
  <search>
    <label class="visually-hidden" for="{uid}-search">Search Shortcuts by name or key</label>
    <input
      bind:this={search}
      bind:value={query}
      id="{uid}-search"
      type="search"
      placeholder="Search by name or key"
      autocomplete="off"
      enterkeyhint="search"
      {onkeydown}
    />
  </search>
  <!-- Its own scroll, so the search stays put as the list scrolls and
       narrows. Tab reaches it, for arrows and Space to scroll it, since
       nothing in it takes focus. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="results" role="region" aria-label="Shortcuts" tabindex="0">
    {#each groups as { group, rows } (group)}
      {@const g = all.findIndex((a) => a.group === group)}
      <section aria-labelledby="{uid}-group-{g}">
        <h3 id="{uid}-group-{g}">{group}</h3>
        <ul>
          {#each rows as row (row.name)}
            <li>
              <div class="what">
                <span class="name">{row.name}</span>
                <span class="muted">{row.description}</span>
              </div>
              <!-- A two-way Shortcut's keys back, then forward, a line each. -->
              <span class="keys">
                {#each row.keys as labels, w (w)}
                  <span class="way">
                    {#if w > 0}<span class="visually-hidden">, then</span>{/if}
                    {#each labels as key, k (k)}
                      {#if k > 0}<span class="muted">or</span>{/if}
                      <kbd>{key}</kbd>
                    {/each}
                  </span>
                {/each}
              </span>
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
  search {
    display: flex;
    flex-direction: column;
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
  .keys {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-1);
    max-width: 50%;
    font-size: var(--text-md);
  }
  .way {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: flex-end;
    gap: var(--space-1);
  }
  kbd {
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    font: inherit;
    white-space: nowrap;
  }
</style>
