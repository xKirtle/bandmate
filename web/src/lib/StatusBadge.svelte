<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { statuses, type Status } from './api';
  import Picker from './Picker.svelte';

  // Given onChange, the badge is a Picker, whose options are badges too.
  let { status, onChange }: { status: Status; onChange?: (status: Status) => void } = $props();
  const id = $props.id();
</script>

{#if onChange}
  <Picker {id} aria-label="Status" options={statuses} value={status} onpick={onChange}>
    {#snippet trigger(s)}
      <span class="badge badge-{s}">{s} <ChevronDown /></span>
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
    text-transform: capitalize;
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
