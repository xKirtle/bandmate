<script lang="ts">
  // PROTOTYPE, throwaway (Rebinding Shortcuts): the dialog searches, shows the
  // keys as rebound, and "Change keys" goes where the variant says: This
  // device's card (A), the Shortcuts tab (B), or edits right here (C).
  import { onMount } from 'svelte';
  import Dialog from './Dialog.svelte';
  import { bindings, changedCount, grouped, label, proto, resetAll } from './shortcuts-prototype/engine.svelte';
  import KeysEditor from './shortcuts-prototype/KeysEditor.svelte';

  let { onClose, editing = false }: { onClose: () => void; editing?: boolean } = $props();

  let dialog = $state<HTMLDialogElement>();
  let search = $state<HTMLInputElement>();
  let query = $state('');
  // svelte-ignore state_referenced_locally
  let edit = $state(editing);
  const groups = $derived(grouped(query));
  const changeHref = $derived(
    proto.variant === 'B' ? '/settings?variant=B&tab=shortcuts' : `/settings?variant=${proto.variant}#shortcuts`,
  );

  onMount(() => search?.focus());
</script>

<Dialog
  bind:dialog
  title="Keyboard shortcuts"
  dismissible={() => true}
  onclose={onClose}
  tabindex={-1}
  --dialog-width="40rem"
  --dialog-gap="var(--space-4)"
>
  <div class="top">
    <input
      bind:this={search}
      class="field"
      type="search"
      placeholder="Search by name or key, e.g. Record or Shift"
      bind:value={query}
    />
    {#if proto.variant === 'C'}
      {#if edit}
        <button type="button" class="button quiet" disabled={changedCount() === 0} onclick={resetAll}
          >Reset to defaults</button
        >
        <button type="button" class="button primary" onclick={() => (edit = false)}>Done</button>
      {:else}
        <button type="button" class="button" onclick={() => (edit = true)}>Change keys</button>
      {/if}
    {:else if proto.variant !== 'current'}
      <a class="button" href={changeHref} onclick={onClose}>Change keys</a>
    {/if}
  </div>
  {#if edit}
    <p class="muted hint">Click a key, then press the one you want; Esc cancels. Kept on this device.</p>
  {/if}
  {#each groups as { group, entries }, g (group)}
    <section aria-labelledby="shortcuts-group-{g}">
      <h3 id="shortcuts-group-{g}">{group}</h3>
      <ul>
        {#each entries as entry (entry.id)}
          <li>
            <div class="what">
              <span class="name">{entry.name}</span>
              <span class="muted">{entry.description}</span>
            </div>
            {#if edit}
              <KeysEditor {entry} />
            {:else}
              <span class="keys">
                {#each bindings[entry.id] as way, w (w)}
                  <span class="way">
                    {#each way.keys as key, k (k)}
                      {#if k > 0}<span class="muted">or</span>{/if}
                      <kbd>{label(key)}</kbd>
                    {:else}
                      <span class="muted">No key</span>
                    {/each}
                  </span>
                {/each}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="muted">No Shortcuts match.</p>
  {/each}
</Dialog>

<style>
  .top {
    display: flex;
    gap: var(--space-2);
  }
  .top input {
    flex: 1;
  }
  .hint {
    margin: 0;
    font-size: var(--text-sm);
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
