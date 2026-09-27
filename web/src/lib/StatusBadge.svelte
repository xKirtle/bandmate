<script lang="ts">
  import type { Status } from './api';

  let { status }: { status: Status } = $props();
</script>

<span class="badge badge-{status}">{status}</span>

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
