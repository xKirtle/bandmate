<script lang="ts">
  import { api, type Song } from '../lib/api';
  import StatusBadge from '../lib/StatusBadge.svelte';

  let { id }: { id: number } = $props();

  let song = $state<Song | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    api.getSong(id).then(
      (s) => (song = s),
      (e: Error) => (error = e.message),
    );
  });
</script>

<header class="bar">
  <a class="back" href="/">← Songs</a>
</header>

<main class="page">
  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if song === null}
    <p class="muted">Loading…</p>
  {:else}
    <h1>{song.title}</h1>
    <StatusBadge status={song.status} />
  {/if}
</main>
