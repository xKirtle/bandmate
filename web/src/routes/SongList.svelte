<script lang="ts">
  import { api, statuses, type SongSummary } from '../lib/api';
  import {
    defaultSongListView,
    songListViewFromParams,
    songListViewToParams,
    sortSongs,
    toggleSort,
    type SongColumn,
  } from '../lib/listViews';
  import { navigate, replaceSearch, router } from '../lib/router.svelte';
  import CoverPlaceholder from '../lib/CoverPlaceholder.svelte';
  import StatusBadge from '../lib/StatusBadge.svelte';
  import { timeAgo } from '../lib/time';

  let songs = $state<SongSummary[] | null>(null);
  let error = $state<string | null>(null);
  // The search, filters and sort start as the URL has them, and are kept in
  // it so going back to the list restores them. The filters combine.
  let view = $state(songListViewFromParams(new URLSearchParams(router.search)));

  const sorted = $derived(songs && sortSongs(songs, view.sort));

  $effect(() => {
    replaceSearch(songListViewToParams(view));
  });

  const columns: { id: SongColumn; label: string; num?: boolean }[] = [
    { id: 'title', label: 'Title' },
    { id: 'status', label: 'Status' },
    { id: 'key', label: 'Key' },
    { id: 'bpm', label: 'BPM', num: true },
    { id: 'master', label: 'Master' },
    { id: 'edited', label: 'Edited' },
  ];

  // A click anywhere on a row opens its Song, as its title link does.
  function openRow(event: MouseEvent, song: SongSummary) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((event.target as Element).closest('a')) return;
    navigate(`/songs/${song.id}`);
  }

  const filtering = $derived(view.status !== undefined || view.hasMaster || view.q.trim() !== '');
  // Not reactive: the first load shouldn't wait, later ones debounce typing.
  let loaded = false;

  // Reloads whenever the filters change, waiting for a pause in typing. Only
  // the latest request's answer is shown.
  $effect(() => {
    const filter = { status: view.status, q: view.q, hasMaster: view.hasMaster || undefined };
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
    view = { ...defaultSongListView, sort: view.sort };
  }
</script>

<header class="bar">
  <h1>Songs</h1>
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
      bind:value={view.q}
      placeholder="Search titles"
      autocomplete="off"
      enterkeyhint="search"
    />
    <div class="chips" role="group" aria-label="Filter Songs">
      <button type="button" class="chip" aria-pressed={view.status === undefined} onclick={() => (view.status = undefined)}>
        All
      </button>
      {#each statuses as s (s)}
        <button type="button" class="chip" aria-pressed={view.status === s} onclick={() => (view.status = s)}>{s}</button>
      {/each}
      <button type="button" class="chip master" aria-pressed={view.hasMaster} onclick={() => (view.hasMaster = !view.hasMaster)}>
        Has a Master
      </button>
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
  {:else if sorted}
    <table class="songs-table">
      <thead>
        <tr>
          {#each columns as column (column.id)}
            <th
              class:num={column.num}
              aria-sort={view.sort.column === column.id ? (view.sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
            >
              <button type="button" onclick={() => (view.sort = toggleSort(view.sort, column.id))}>
                {column.label}<span class="arrow" aria-hidden="true"
                  >{view.sort.column === column.id ? (view.sort.direction === 'asc' ? '↑' : '↓') : ''}</span
                >
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each sorted as song (song.id)}
          <tr onclick={(event) => openRow(event, song)}>
            <td class="title">
              <span class="with-cover">
                <CoverPlaceholder title={song.title} status={song.status} />
                <a href="/songs/{song.id}">{song.title}</a>
              </span>
            </td>
            <td><StatusBadge status={song.status} /></td>
            <td>{song.key || '—'}</td>
            <td class="num">{song.bpm ?? '—'}</td>
            <td>
              {#if song.hasMaster}<span aria-hidden="true">✓</span><span class="visually-hidden">Has a Master</span
                >{:else}—{/if}
            </td>
            <td class="muted"><time datetime={song.updatedAt}>{timeAgo(song.updatedAt)}</time></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <ul class="songs">
      {#each sorted as song (song.id)}
        <li>
          <a href="/songs/{song.id}">
            <CoverPlaceholder title={song.title} status={song.status} />
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
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip {
    flex-shrink: 0;
    min-height: var(--control);
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
  .chip.master {
    text-transform: none;
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
    gap: 0.75rem;
    padding: 0.5rem 0.25rem;
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
  .songs .title {
    flex: 1;
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

  /* Desktop shows a table, narrower windows the list. */
  .songs-table {
    display: none;
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  th {
    padding: 0;
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }
  th button {
    width: 100%;
    min-height: var(--control);
    padding: 0 0.5rem;
    border: none;
    border-radius: 0.25rem;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 600;
    text-align: inherit;
    cursor: pointer;
  }
  th button:hover,
  th[aria-sort] button {
    color: var(--text);
  }
  .arrow {
    display: inline-block;
    width: 1em;
    margin-left: 0.25rem;
  }
  /* Rows fit the Cover with some room around it. */
  td {
    height: calc(var(--cover-list) + 0.75rem);
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  td.title {
    width: 100%;
    max-width: 0;
    overflow: hidden;
    font-weight: 600;
  }
  .with-cover {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  td.title a {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: inherit;
    text-decoration: none;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover,
  tbody tr:focus-within {
    background: var(--surface-1);
  }

  @media (min-width: 80rem) {
    .songs-table {
      display: table;
    }
    .songs {
      display: none;
    }
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
