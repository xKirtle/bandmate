<script lang="ts">
  // Settings: its header, and its tabs over what the open one holds. Each
  // tab is a link to its own address, so Back, a reload and a link all open
  // it.
  import type { Snippet } from 'svelte';
  import { settingsTabs, type SettingsTab } from './nav';

  let { tab, children }: { tab: SettingsTab; children: Snippet } = $props();
</script>

<header class="bar">
  <h1>Settings</h1>
</header>

<main class="page">
  <nav class="tabs" aria-label="Settings">
    {#each settingsTabs as t (t.id)}
      <a href={t.href} aria-current={t.id === tab ? 'page' : undefined}>{t.label}</a>
    {/each}
  </nav>
  <div class="content">
    {@render children()}
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
</style>
