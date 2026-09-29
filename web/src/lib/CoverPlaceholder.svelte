<script lang="ts">
  import type { Status } from './api';
  import { coverInitial } from './cover';

  // Stands in for a Song's Cover: a square tinted by its Status, with the
  // title's first letter. Decorative, as the title is always beside it.
  let { title, status, size = 'list' }: { title: string; status: Status; size?: 'list' | 'header' } = $props();
</script>

<span class="cover cover-{status} {size}" aria-hidden="true">{coverInitial(title)}</span>

<style>
  .cover {
    --size: var(--cover-list);
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--size);
    height: var(--size);
    border-radius: calc(var(--size) * 0.18);
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: calc(var(--size) * 0.45);
    font-weight: 700;
    line-height: 1;
    overflow: hidden;
    user-select: none;
  }
  .header {
    --size: var(--cover-header);
  }
  .cover-drafting {
    background: var(--drafting-bg);
    color: var(--drafting-fg);
  }
  .cover-finished {
    background: var(--finished-bg);
    color: var(--finished-fg);
  }
</style>
