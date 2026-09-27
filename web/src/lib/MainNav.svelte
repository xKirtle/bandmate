<script lang="ts">
  // Switches between the top-level pages. The current one is the page's
  // heading.
  let { current }: { current: 'songs' | 'beats' } = $props();

  const pages = [
    { id: 'songs', href: '/', label: 'Songs' },
    { id: 'beats', href: '/beats', label: 'Beats' },
  ] as const;
</script>

<nav aria-label="Library">
  {#each pages as page (page.id)}
    {#if page.id === current}
      <h1><a href={page.href} aria-current="page">{page.label}</a></h1>
    {:else}
      <a href={page.href}>{page.label}</a>
    {/if}
  {/each}
</nav>

<style>
  nav {
    display: flex;
    align-items: baseline;
    gap: 1rem;
  }
  h1 {
    margin: 0;
  }
  a {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    color: var(--text-muted);
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.2;
    text-decoration: none;
  }
  a:hover {
    color: var(--text);
  }
  a[aria-current='page'] {
    color: var(--text);
  }
</style>
