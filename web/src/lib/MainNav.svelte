<script lang="ts">
  // Switches between the top-level pages, the same at every width: a nav rail
  // down the left of wide windows, a tab bar along the bottom of narrow ones.
  import BrandMark from './BrandMark.svelte';
  import { currentPage, listAt, pages, pinned, type MainPage } from './nav';
  import { router } from './router.svelte';

  const current = $derived(currentPage(router.path));

  // Each list's query string as it was last left, so going back to it
  // restores its search, filters and sort.
  let lastSearch = $state<Partial<Record<MainPage, string>>>({});
  $effect.pre(() => {
    const list = listAt(router.path);
    if (list) lastSearch[list] = router.search;
  });
</script>

<nav aria-label="Library">
  <span class="brand"><BrandMark /></span>
  {#each pages as page (page.id)}
    <a href={page.href + (lastSearch[page.id] ?? '')} aria-current={page.id === current ? 'page' : undefined}>
      <span class="nav-icon" aria-hidden="true"><page.icon /></span>
      {page.label}
    </a>
  {/each}
  {#each pinned as page, i (page.id)}
    <a class:first-pinned={i === 0} href={page.href} aria-current={page.id === current ? 'page' : undefined}>
      <span class="nav-icon" aria-hidden="true"><page.icon /></span>
      {page.label}
    </a>
  {/each}
</nav>

<style>
  /* The tab bar, kept clear of the home indicator. The tabs have as much
     space below them as above, on top of the home indicator's inset: with
     none below, they'd touch the screen's edge, and a rounded corner would
     cut off a corner tab's highlight. */
  nav {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 2;
    display: flex;
    height: var(--tabbar-space);
    padding: var(--space-1) max(var(--space-2), env(safe-area-inset-right))
      calc(var(--space-1) + env(safe-area-inset-bottom)) max(var(--space-2), env(safe-area-inset-left));
    border-top: 1px solid var(--border);
    background: var(--surface-1);
  }
  .brand {
    display: none;
  }
  a {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border-radius: var(--radius-md);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    /* A label too long for its tab, e.g. with a large system font on a
       narrow phone, wraps under its icon, centred. */
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
  }
  /* The icon alone, with no line's space below its baseline. */
  .nav-icon {
    display: flex;
    font-size: var(--text-xl);
  }
  a:hover {
    color: var(--text);
  }
  a[aria-current='page'] {
    background: var(--surface-2);
    color: var(--accent);
  }

  /* The nav rail, in view however far the page scrolls, with Settings
     pinned to its bottom, apart from the lists. */
  @media (min-width: 65.5rem) {
    nav {
      position: sticky;
      top: 0;
      flex-direction: column;
      gap: var(--space-1);
      height: 100vh;
      height: 100dvh;
      padding: var(--space-3) var(--space-2);
      border-top: none;
      border-right: 1px solid var(--border);
    }
    .brand {
      display: grid;
      place-items: center;
      height: 2.25rem;
      margin-bottom: var(--space-3);
    }
    a {
      flex: none;
      padding: var(--space-2) var(--space-1);
    }
    a:hover {
      background: var(--surface-2);
    }
    /* Pushes the pinned link to the bottom. */
    .first-pinned {
      margin-top: auto;
    }
  }
</style>
