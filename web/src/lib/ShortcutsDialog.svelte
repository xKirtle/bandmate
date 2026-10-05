<script lang="ts">
  import { onMount } from 'svelte';
  import { closeOnBackdrop } from './backdrop';
  import { platform, shortcuts } from './shortcuts';
  import { dialogGroups } from './shortcutsDialog';

  // Every Shortcut on the Song page, in its group, with its keys as this
  // platform names them. All are listed wherever they work, e.g. Sync mode's
  // while it's off: each group's heading says where.
  let { onClose }: { onClose: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  const groups = dialogGroups(shortcuts, platform());

  // It takes focus itself, not its ✕, so Space scrolls the list rather
  // than closing it, as arrows do.
  onMount(() => {
    dialog?.showModal();
    dialog?.focus();
  });
</script>

<dialog
  bind:this={dialog}
  {@attach closeOnBackdrop(() => true)}
  onclose={onClose}
  aria-labelledby="shortcuts-heading"
  tabindex="-1"
>
  <header>
    <h2 id="shortcuts-heading">Keyboard shortcuts</h2>
    <button type="button" class="icon" onclick={() => dialog?.close()} aria-label="Close">✕</button>
  </header>

  {#each groups as { group, rows }, g (group)}
    <section aria-labelledby="shortcuts-group-{g}">
      <h3 id="shortcuts-group-{g}">{group}</h3>
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
  {/each}
</dialog>

<style>
  dialog {
    width: min(40rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg);
    color: var(--text);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  /* Focused itself only to hold focus for the list. */
  dialog:focus-visible {
    outline: none;
  }
  dialog::backdrop {
    background: var(--scrim);
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }
  h2 {
    margin: 0;
    font-size: var(--text-xl);
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
