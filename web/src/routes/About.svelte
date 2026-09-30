<script lang="ts">
  // Which Bandmate is running, with a link to exactly that version's source,
  // as AGPL-3.0 §13 asks of anyone running a modified Bandmate over a network.
  import { api, type ServerConfig } from '../lib/api';
  import BrandMark from '../lib/BrandMark.svelte';

  let config = $state<ServerConfig | null>(null);
  let error = $state<string | null>(null);

  api.getConfig().then(
    (c) => (config = c),
    (e) => (error = e instanceof Error ? e.message : String(e)),
  );
</script>

<header class="bar">
  <h1>About</h1>
</header>

<main class="page">
  <section class="about">
    <BrandMark size="4rem" />
    <h2>Bandmate</h2>
    {#if config}
      <p class="version">Version <code>{config.version}</code></p>
    {:else if error}
      <p class="error" role="alert">Couldn't load the version: {error}</p>
    {/if}

    <ul class="links">
      {#if config}
        <li><a href={config.sourceUrl}>Source code</a></li>
      {/if}
    </ul>

    <p class="muted">
      Bandmate is free software under the
      <a href="https://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL v3</a>.
    </p>
  </section>
</main>

<style>
  .about {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding-top: 2rem;
    text-align: center;
  }
  h2 {
    margin: 0.5rem 0 0;
  }
  .version {
    margin: 0;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem 1.5rem;
    margin: 1rem 0 0;
    padding: 0;
    list-style: none;
  }
</style>
