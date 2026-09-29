<script lang="ts">
  import { api, type Status } from './api';
  import CoverPlaceholder from './CoverPlaceholder.svelte';

  // A Song's Cover, or its placeholder while it has none. Decorative, as
  // the title is always beside it.
  let {
    songId,
    coverId,
    title,
    status,
    size = 'list',
  }: { songId: number; coverId: number | null; title: string; status: Status; size?: 'list' | 'header' } =
    $props();
</script>

{#if coverId === null}
  <CoverPlaceholder {title} {status} {size} />
{:else}
  <img class="cover {size}" src={api.coverUrl(songId, coverId, size)} alt="" draggable="false" />
{/if}

<style>
  .cover {
    --size: var(--cover-list);
    display: block;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: calc(var(--size) * 0.18);
    background: var(--surface-2);
    object-fit: cover;
    user-select: none;
  }
  .header {
    --size: var(--cover-header);
  }
</style>
