<script lang="ts">
  // The Demo Song's page, at /songs/demo, shown only while a Tour runs: the
  // Demo is put back as built into Bandmate, then its page shows as any
  // Song's does. Outside a Tour, a reload included (nothing of a Tour is
  // kept), it sends to the Songs page.
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import { navigate } from '../lib/router.svelte';
  import { tour } from '../lib/theTour';
  import SongPage from './SongPage.svelte';

  let id = $state<number | null>(null);
  let error = $state<string | null>(null);

  // Once the page has mounted: going elsewhere while App is still putting it
  // in place is lost.
  onMount(() => {
    if (!tour.running) navigate('/', { replace: true });
  });

  if (tour.running) {
    api.putDemoBack().then(
      (song) => (id = song.id),
      (e: Error) => {
        error = e.message;
        // Nothing to show: the Tour ends, leaving the page free to go elsewhere.
        tour.left();
      },
    );
  }
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
