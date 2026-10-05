<script lang="ts">
  // Settings: its header, with the open tab's actions beside its title, and
  // its tabs over what the open one holds. Each tab is a link to its own
  // address, so Back, a reload and a link all open it.
  import type { Snippet } from 'svelte';
  import { settingsTabs, type SettingsTab } from './nav';

  let { tab, barActions, children }: { tab: SettingsTab; barActions?: Snippet; children: Snippet } = $props();
</script>

<header class="bar">
  <h1>Settings</h1>
  {@render barActions?.()}
</header>

<main class="page">
  <nav class="tabs" aria-label="Settings">
    {#each settingsTabs as t (t.id)}
      <a href={t.href} aria-current={t.id === tab ? 'page' : undefined}>{t.label}</a>
    {/each}
  </nav>
  {@render children()}
</main>

<style>
  /* On a narrow phone, a tab's actions go under the title rather than
     squeeze it. */
  .bar {
    flex-wrap: wrap;
  }
  h1 {
    white-space: nowrap;
  }
  .tabs {
    margin-bottom: var(--space-4);
    border-bottom: 1px solid var(--border);
  }
</style>
