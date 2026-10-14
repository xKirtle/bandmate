<script lang="ts">
  // The Demo Song's page, at /songs/demo: the Demo is put back as built
  // into Bandmate, then its page shows as any Song's does.
  import { api } from '../lib/api';
  import SongPage from './SongPage.svelte';

  let id = $state<number | null>(null);
  let error = $state<string | null>(null);

  api.putDemoBack().then(
    (song) => (id = song.id),
    (e: Error) => (error = e.message),
  );
</script>

{#if id !== null}
  <SongPage {id} />
{:else}
  <main class="page">
    {#if error}
      <p class="error" role="alert">{error}</p>
    {:else}
      <p class="muted">Loading…</p>
    {/if}
  </main>
{/if}
