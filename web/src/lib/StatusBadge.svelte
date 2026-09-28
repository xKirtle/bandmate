<script lang="ts">
  import { statuses, type Status } from './api';

  // Given onChange, the badge is a picker: a native select laid over the
  // pill, so phones show their own picker and it works by keyboard.
  let { status, onChange }: { status: Status; onChange?: (status: Status) => void } = $props();
</script>

{#if onChange}
  <span class="picker">
    <span class="badge badge-{status}" aria-hidden="true">{status} ▾</span>
    <select aria-label="Status" value={status} onchange={(e) => onChange(e.currentTarget.value as Status)}>
      {#each statuses as s (s)}
        <!-- Native pickers ignore text-transform. -->
        <option value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
      {/each}
    </select>
  </span>
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
  /* The pill looks small; the select over it keeps the tap target full size. */
  .picker {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
  }
  .picker select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    min-height: 0;
    opacity: 0;
    cursor: pointer;
  }
  .picker:has(select:focus-visible) .badge {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
