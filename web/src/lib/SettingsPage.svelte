<script lang="ts">
  // Settings: its header, and its tabs over what the open one holds. Each
  // tab is a link to its own address, so Back, a reload and a link all open
  // it.
  import type { Snippet } from 'svelte';
  import { settingsTabs, type SettingsTab } from './nav';
  import { router } from './router.svelte';

  let { tab, children, aside }: { tab: SettingsTab; children: Snippet; aside?: Snippet } = $props();

  // PROTOTYPE, throwaway (Rebinding Shortcuts): variant B adds a Shortcuts tab.
  const params = $derived(new URLSearchParams(router.search));
  const protoB = $derived(import.meta.env.DEV && params.get('variant') === 'B');
  const onShortcuts = $derived(protoB && params.get('tab') === 'shortcuts');
</script>

<header class="bar">
  <h1>Settings</h1>
</header>

<main class="page">
  <nav class="tabs" aria-label="Settings">
    {#each settingsTabs as t (t.id)}
      <a
        href={protoB ? `${t.href}?variant=B` : t.href}
        aria-current={t.id === tab && !onShortcuts ? 'page' : undefined}>{t.label}</a
      >
      {#if protoB && t.id === 'device'}
        <a href="/settings?variant=B&tab=shortcuts" aria-current={onShortcuts ? 'page' : undefined}>Shortcuts</a>
      {/if}
    {/each}
  </nav>
  <div class="with-aside" class:has-aside={!!aside}>
    <div class="content">
      {@render children()}
    </div>
    {#if aside}
      <aside>{@render aside()}</aside>
    {/if}
  </div>
</main>

<style>
  .tabs {
    margin-bottom: var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  /* Every tab's content shares one width, so switching tabs doesn't make
     the page jump on a wide window. The header and tabs span the page. */
  .content {
    max-width: var(--settings-max-width);
  }
  .has-aside {
    display: grid;
    grid-template-columns: minmax(0, var(--settings-max-width)) 13rem;
    align-items: start;
    gap: var(--space-8);
  }
  aside {
    position: sticky;
    top: var(--space-4);
  }
  /* PROTOTYPE: the outline only where there's room beside the cards. */
  @media (width < 64rem) {
    .has-aside {
      display: block;
    }
    aside {
      display: none;
    }
  }
</style>
