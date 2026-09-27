<script lang="ts">
  import { api, type SongSummary } from '../lib/api';
  import StatusBadge from '../lib/StatusBadge.svelte';
  import { timeAgo } from '../lib/time';

  let songs = $state<SongSummary[] | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    api.listSongs().then(
      (list) => (songs = list),
      (e: Error) => (error = e.message),
    );
  });
</script>

<header class="bar">
  <h1>Songs</h1>
  <a class="button primary" href="/songs/new">New Song</a>
</header>

<main class="page">
  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if songs === null}
    <p class="muted">Loading…</p>
  {:else if songs.length === 0}
    <div class="empty">
      <p>No Songs yet.</p>
      <a class="button primary" href="/songs/new">Write your first Song</a>
    </div>
  {:else}
    <ul class="songs">
      {#each songs as song (song.id)}
        <li>
          <a href="/songs/{song.id}">
            <span class="title">{song.title}</span>
            <span class="meta">
              <StatusBadge status={song.status} />
              <time datetime={song.updatedAt}>{timeAgo(song.updatedAt)}</time>
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .songs {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--border);
  }
  .songs a {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 3.5rem;
    padding: 0.75rem 0.25rem;
    border-bottom: 1px solid var(--border);
    color: inherit;
    text-decoration: none;
  }
  .songs a:hover,
  .songs a:focus-visible {
    background: var(--surface-1);
  }
  .title {
    font-weight: 600;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }
  .empty {
    text-align: center;
    padding: 3rem 0;
  }
</style>
