<script lang="ts">
  import { statuses, type Status } from './api';
  import Picker from './Picker.svelte';

  // Given onChange, the badge is a Picker, whose options are badges too.
  let { status, onChange }: { status: Status; onChange?: (status: Status) => void } = $props();
</script>

{#if onChange}
  <Picker id="status" aria-label="Status" options={statuses} value={status} onpick={onChange}>
    {#snippet trigger(s)}
      <span class="badge badge-{s}">{s} <span aria-hidden="true">▾</span></span>
    {/snippet}
    {#snippet option(s)}
      <span class="badge badge-{s}">{s}</span>
    {/snippet}
  </Picker>
{:else}
  <span class="badge badge-{status}">{status}</span>
{/if}

<style>
  .badge {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: capitalize;
    white-space: nowrap;
    background: var(--surface-2);
    color: var(--text-muted);
  }
  .badge-drafting {
    background: var(--drafting-bg);
    color: var(--drafting-fg);
  }
  .badge-finished {
    background: var(--finished-bg);
    color: var(--finished-fg);
  }
</style>
