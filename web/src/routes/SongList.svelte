<script lang="ts">
  import { api, statuses, type SongSummary, type Status } from '../lib/api';
  import MainNav from '../lib/MainNav.svelte';
  import StatusBadge from '../lib/StatusBadge.svelte';
  import { timeAgo } from '../lib/time';

  let songs = $state<SongSummary[] | null>(null);
  let error = $state<string | null>(null);
  let status = $state<Status | undefined>();
  let q = $state('');

  const filtering = $derived(status !== undefined || q.trim() !== '');
  // Not reactive: the first load shouldn't wait, later ones debounce typing.
  let loaded = false;

  // Reloads whenever the filters change, waiting for a pause in typing. Only
  // the latest request's answer is shown.
  $effect(() => {
    const filter = { status, q };
    let current = true;
    const timer = setTimeout(() => {
      api.listSongs(filter).then(
        (list) => {
          if (!current) return;
          songs = list;
          error = null;
          loaded = true;
        },
        (e: Error) => current && (error = e.message),
      );
    }, loaded ? 200 : 0);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  });

  function clearFilters() {
    status = undefined;
    q = '';
  }
</script>

<header class="bar">
  <MainNav current="songs" />
  <div class="actions">
    <a class="button" href="/songs/import">Import</a>
    <a class="button primary" href="/songs/new">New Song</a>
  </div>
</header>

<main class="page">
  <search class="filters">
    <label class="visually-hidden" for="song-search">Search Songs by title</label>
    <input
      id="song-search"
      type="search"
      bind:value={q}
      placeholder="Search titles"
      autocomplete="off"
      enterkeyhint="search"
    />
    <div class="chips" role="group" aria-label="Filter by Status">
      <button type="button" class="chip" aria-pressed={status === undefined} onclick={() => (status = undefined)}>
        All
      </button>
      {#each statuses as s (s)}
        <button type="button" class="chip" aria-pressed={status === s} onclick={() => (status = s)}>{s}</button>
      {/each}
    </div>
  </search>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if songs === null}
    <p class="muted">Loading…</p>
  {:else if songs.length === 0 && filtering}
    <div class="empty">
      <p>No Songs match.</p>
      <button type="button" class="button" onclick={clearFilters}>Clear filters</button>
    </div>
  {:else if songs.length === 0}
    <div class="empty">
      <p>No Songs yet.</p>
      <a class="button primary" href="/songs/new">Write your first Song</a>
      <a class="button" href="/songs/import">Import one</a>
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
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .chips {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
  }
  .chip {
    flex-shrink: 0;
    min-height: 2.75rem;
    padding: 0 1rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    text-transform: capitalize;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }
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

  @media (min-width: 36rem) {
    .filters {
      flex-direction: row;
      align-items: center;
    }
    .filters input {
      flex: 1;
    }
  }
</style>
