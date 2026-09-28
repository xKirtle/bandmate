<script lang="ts">
  // Switches between the top-level pages, the same at every width: a nav rail
  // down the left of wide windows, a tab bar along the bottom of narrow ones.
  import { currentPage, listAt, pages, type LibraryPage } from './nav';
  import { router } from './router.svelte';

  const current = $derived(currentPage(router.path));

  // Each list's query string as it was last left, so going back to it
  // restores its search, filters and sort.
  let left = $state<Partial<Record<LibraryPage, string>>>({});
  $effect.pre(() => {
    const list = listAt(router.path);
    if (list) left[list] = router.search;
  });
</script>

<nav aria-label="Library">
  <span class="brand" aria-hidden="true">B</span>
  {#each pages as page (page.id)}
    <a href={page.href + (left[page.id] ?? '')} aria-current={page.id === current ? 'page' : undefined}>
      <span class="glyph" aria-hidden="true">{page.icon}</span>
      {page.label}
    </a>
  {/each}
</nav>

<style>
  /* The tab bar, kept clear of the home indicator. */
  nav {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 2;
    display: flex;
    height: var(--tabbar-space);
    padding: 0.25rem max(0.5rem, env(safe-area-inset-right)) env(safe-area-inset-bottom)
      max(0.5rem, env(safe-area-inset-left));
    border-top: 1px solid var(--border);
    background: var(--surface-1);
  }
  .brand {
    display: none;
  }
  a {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    padding: 0.25rem;
    border-radius: 0.5rem;
    color: var(--text-muted);
    font-size: 0.6875rem;
    font-weight: 600;
    text-decoration: none;
  }
  .glyph {
    font-size: 1.25rem;
    line-height: 1;
  }
  a:hover {
    color: var(--text);
  }
  a[aria-current='page'] {
    background: var(--surface-2);
    color: var(--accent);
  }

  /* The nav rail, in view however far the page scrolls. */
  @media (min-width: 65.5rem) {
    nav {
      position: sticky;
      top: 0;
      flex-direction: column;
      gap: 0.25rem;
      height: 100vh;
      height: 100dvh;
      padding: 0.75rem 0.375rem;
      border-top: none;
      border-right: 1px solid var(--border);
    }
    .brand {
      display: grid;
      place-items: center;
      height: 2.25rem;
      margin-bottom: 0.75rem;
      color: var(--accent);
      font-size: 1.25rem;
      font-weight: 800;
    }
    a {
      flex: none;
      padding: 0.5rem 0.25rem;
    }
    a:hover {
      background: var(--surface-2);
    }
  }
</style>
