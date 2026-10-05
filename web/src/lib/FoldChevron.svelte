<script lang="ts">
  import ChevronRight from '@lucide/svelte/icons/chevron-right';

  // A fold's chevron, at the start of its summary: it points right while
  // the fold is closed and turns down as it opens (see docs/design.md,
  // Components).
</script>

<span class="fold-chevron" aria-hidden="true"><ChevronRight /></span>

<style>
  .fold-chevron {
    display: inline-flex;
    color: var(--text-muted);
    transition: transform var(--duration-fast) var(--ease);
  }
  :global(details[open] > summary) .fold-chevron {
    transform: rotate(90deg);
  }
</style>
