<script lang="ts">
  // Which Bandmate is running, with a link to exactly that version's source,
  // as AGPL-3.0 §13 asks of anyone running a modified Bandmate over a network.
  import { api, type ServerConfig } from '../lib/api';
  import BrandMark from '../lib/BrandMark.svelte';

  let config = $state<ServerConfig | null>(null);
  let error = $state<string | null>(null);

  api.getConfig().then(
    (c) => (config = c),
    (e: Error) => (error = e.message),
  );
</script>

<header class="bar">
  <h1>About</h1>
</header>

<main class="page">
  <section class="intro">
    <BrandMark size="4rem" />
    <h2>Bandmate</h2>
    {#if config}
      <p>Version <code>{config.version}</code></p>
      <ul class="links">
        <li><a href={config.sourceUrl}>Source code</a></li>
        <li><a href={config.bugReportUrl}>Report a bug</a></li>
      </ul>
    {:else if error}
      <p class="error" role="alert">Couldn't load the version: {error}</p>
    {/if}

    <p class="muted">
      Bandmate is free software under the
      <a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL v3</a>.
    </p>
  </section>
</main>

<style>
  /* A card of the app's usual panel style, at the page's left edge like the
     other pages' content, kept narrow so it doesn't stretch across a wide
     window. */
  .intro {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    max-width: 28rem;
    padding: 2rem 1rem 1.5rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--surface-1);
    text-align: center;
  }
  .intro p {
    margin: 0;
  }
  h2 {
    margin: 0.5rem 0 0;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem 1.5rem;
    margin: 0.5rem 0;
    padding: 0;
    list-style: none;
  }
</style>
