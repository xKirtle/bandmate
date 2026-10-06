<script lang="ts">
  // A Song's Tags, as badges that wrap: shown, never changed here.
  let { tags }: { tags: readonly string[] } = $props();
</script>

{#if tags.length > 0}
  <ul class="tags" aria-label="Tags">
    {#each tags as name (name)}
      <li class="badge tag">{name}</li>
    {/each}
  </ul>
{/if}

<style>
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
