<script lang="ts">
  // A listed Shortcut's keys, as plain key labels: for a two-way one, its
  // keys going back, then forward, a line each (see shortcutList.ts). A
  // Shortcut, or a way, with no key says so.
  let { keys }: { keys: string[][] } = $props();
</script>

<span class="keys">
  {#if keys.every((labels) => labels.length === 0)}
    <span class="muted">No key</span>
  {:else}
    {#each keys as labels, w (w)}
      <span class="way">
        {#if w > 0}<span class="visually-hidden">, then</span>{/if}
        {#each labels as key, k (k)}
          {#if k > 0}<span class="muted">or</span>{/if}
          <kbd>{key}</kbd>
        {:else}
          <span class="muted">No key</span>
        {/each}
      </span>
    {/each}
  {/if}
</span>

<style>
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
