<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Check from '@lucide/svelte/icons/check';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import FolderInput from '@lucide/svelte/icons/folder-input';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ActionsMenu from '../lib/ActionsMenu.svelte';
  import { ApiError, api, statuses, type Folder, type SongSummary, type Status } from '../lib/api';
  import DeleteFolderDialog from '../lib/DeleteFolderDialog.svelte';
  import FilterButton from '../lib/FilterButton.svelte';
  import FolderNameDialog from '../lib/FolderNameDialog.svelte';
  import {
    defaultSongListView,
    isSongListFiltered,
    loadSongList,
    songCount,
    songListViewFromParams,
    songListFilter,
    songListViewToParams,
    sortFolders,
    sortSongs,
    statusFilterLabel,
    toggleSort,
    type SongColumn,
  } from '../lib/listViews';
  import type { MenuAction } from '../lib/menu';
  import { newSongPath } from '../lib/newSong';
  import { navigate, replaceSearch, router } from '../lib/router.svelte';
  import SongCover from '../lib/SongCover.svelte';
  import { SongDragging, songTarget } from '../lib/songDragging.svelte';
  import StatusBadge from '../lib/StatusBadge.svelte';
  import { timeAgo } from '../lib/time';

  let {
    folderId,
  }: {
    /** The Folder open, whose Songs are listed; left out, the top level: the Folders, then the Songs in none. */
    folderId?: number;
  } = $props();

  let songs = $state<SongSummary[] | null>(null);
  let folders = $state<Folder[] | null>(null);
  // Whether there are any Songs at all, whatever the filters: in the Folder
  // open, or anywhere at the top level. Without any, the search and filters
  // have nothing to act on, so they're hidden, and cleared so ones from the
  // URL don't hide the first Song once it's made.
  let anySongs = $state(true);
  let error = $state<string | null>(null);
  // The search, filters and sort start as the URL has them, and are kept in
  // it so going back to the list restores them. The filters combine.
  let view = $state(songListViewFromParams(new URLSearchParams(router.search)));
  // Bumped to load the list again, e.g. once a Song has moved.
  let changes = $state(0);

  const sorted = $derived(songs && sortSongs(songs, view.sort));
  const filtered = $derived(isSongListFiltered(view));
  // Whether the Songs shown are every Song, whatever Folder it's in, as at the
  // top level while a search or filter is on: then the Folders give way to
  // one list of Songs, each showing its Folder. Taken from the list as last
  // loaded, not the filters as typed, so the two never show out of step.
  let acrossFolders = $state(false);
  // Every Folder by name, for the menus; at the top level they come first,
  // whatever the Songs are sorted by, but for while the list is every Song.
  const sortedFolders = $derived(folders ? sortFolders(folders) : []);
  const listedFolders = $derived(folderId === undefined && !acrossFolders ? sortedFolders : []);
  const folderNames = $derived(new Map(folders?.map((f) => [f.id, f.name])));
  const folder = $derived(folderId === undefined ? undefined : folders?.find((f) => f.id === folderId));
  const folderMissing = $derived(folderId !== undefined && folders !== null && !folder);
  // A Folder opens with the Songs sorted as they are here, and the way back
  // out keeps that sort.
  const folderSearch = $derived(songListViewToParams({ ...defaultSongListView, sort: view.sort }).toString());

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

  const folderHref = (f: Folder) => `/folders/${f.id}` + (folderSearch ? `?${folderSearch}` : '');
  const topHref = $derived(folderSearch ? `/?${folderSearch}` : '/');

  // A click anywhere on a row opens what it's for, as its title link does,
  // but for a click on a link or in its menu.
  function openRow(event: MouseEvent, href: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((event.target as Element).closest('a, button, [role="menu"]')) return;
    navigate(href);
  }

  // Not reactive: the first load shouldn't wait, later ones debounce typing.
  let loaded = false;

  // Reloads whenever the filters change, waiting for a pause in typing. Only
  // the latest request's answer is shown.
  $effect(() => {
    const filter = songListFilter(view, folderId);
    void changes;
    let current = true;
    const timer = setTimeout(
      () => {
        // A Folder that doesn't exist lists no Songs: the Folders say it's missing.
        const listing = loadSongList(filter, api.listSongs).catch((e: Error) => {
          if (folderId !== undefined && e instanceof ApiError && e.status === 404)
            return { songs: [], anySongs: false };
          throw e;
        });
        Promise.all([listing, api.listFolders()]).then(
          ([result, allFolders]) => {
            if (!current) return;
            songs = result.songs;
            acrossFolders = filter.folder === undefined;
            anySongs = result.anySongs;
            folders = allFolders;
            if (!anySongs && (view.statuses.length > 0 || view.hasMaster || view.q)) clearFilters();
            error = null;
            loaded = true;
          },
          (e: Error) => current && (error = e.message),
        );
      },
      loaded ? 200 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  });

  // "New Song" makes an "Untitled Song" straight away, in the Folder open if
  // any, and opens it, its title ready to type over. Back returns here.
  let creating = $state(false);
  let createError = $state<string | null>(null);

  async function createSong() {
    creating = true;
    createError = null;
    try {
      const song = await api.createSong(folderId ?? null);
      navigate(newSongPath(song.id));
    } catch (e) {
      createError = (e as Error).message;
      creating = false;
    }
  }

  const importHref = $derived(folderId === undefined ? '/songs/import' : `/songs/import?folder=${folderId}`);

  function clearFilters() {
    view = { ...defaultSongListView, sort: view.sort };
  }

  // Picking Statuses keeps them in lifecycle order, as the button names them.
  function pickStatus(status: Status, on: boolean) {
    view.statuses = statuses.filter((s) => (s === status ? on : view.statuses.includes(s)));
  }

  // "New folder" is open, and, from a Song's menu, which Song goes into the
  // Folder once it's made.
  let newFolder = $state<{ for: SongSummary | null } | null>(null);
  let moveError = $state<string | null>(null);

  async function moveSong(song: SongSummary, to: number | null) {
    if (song.folderId === to) return;
    moveError = null;
    try {
      await api.moveSongToFolder(song.id, to);
    } catch (e) {
      moveError = `Couldn't move “${song.title}” (${(e as Error).message})`;
    }
    changes++;
  }

  // A Song dragged onto a Folder's row moves into it, and, inside a Folder,
  // onto the "Songs" link out of it. There's nowhere to drop while a search
  // lists every Song, as the Folders give way to it.
  let header = $state<HTMLElement>();
  const dragging = new SongDragging(
    () => !folderMissing && (folderId !== undefined || listedFolders.length > 0),
    () => ({
      top: header?.getBoundingClientRect().bottom ?? 0,
      // Above the tab bar, on a phone, which the page's foot leaves room for.
      bottom: innerHeight - parseFloat(getComputedStyle(document.body).paddingBottom),
    }),
    (song, to) => moveSong(song, to),
  );

  function madeFolder(made: Folder) {
    const song = newFolder?.for;
    if (song) moveSong(song, made.id);
    else changes++;
  }

  // The Folder being renamed, if any, and the one asked about deleting, by
  // id, so the dialog follows its Songs as the list loads again, e.g. after
  // deleting them failed partway.
  let renaming = $state<Folder | null>(null);
  let deletingId = $state<number | null>(null);
  const deleting = $derived(deletingId === null ? undefined : folders?.find((f) => f.id === deletingId));
  // Gone meanwhile, e.g. deleted elsewhere, it's no longer asked about.
  $effect(() => {
    if (deletingId !== null && folders && !deleting) deletingId = null;
  });
  let folderError = $state<string | null>(null);

  // An empty Folder is deleted without asking; one holding Songs asks
  // whether to keep them.
  async function deleteFolder(f: Folder) {
    folderError = null;
    if (f.songs > 0) {
      deletingId = f.id;
      return;
    }
    try {
      await api.deleteFolder(f, 'keep');
      deletedFolder(f);
    } catch (e) {
      folderError = `Couldn't delete “${f.name}” (${(e as Error).message})`;
    }
  }

  // Deleted from its own heading, the Folder's page goes with it, so the
  // way back skips it.
  function deletedFolder(f: Folder) {
    if (f.id === folderId) navigate(topHref, { replace: true });
    else changes++;
  }

  function folderActions(f: Folder): MenuAction[] {
    return [
      {
        icon: Pencil,
        label: 'Rename…',
        run: () => {
          folderError = null;
          renaming = f;
        },
      },
      { icon: Trash2, label: f.songs > 0 ? 'Delete…' : 'Delete', run: () => deleteFolder(f) },
    ];
  }

  // Filing a Song is organising, not editing it, so it's offered for every
  // Song, Finished ones included.
  function songActions(song: SongSummary): MenuAction[] {
    return [
      {
        icon: FolderInput,
        label: 'Move to folder…',
        choices: [
          ...sortedFolders.map((f) => ({
            label: f.name,
            checked: song.folderId === f.id,
            run: () => moveSong(song, f.id),
          })),
          { label: 'No folder', checked: song.folderId === null, run: () => moveSong(song, null) },
          { label: 'New folder…', run: () => (newFolder = { for: song }) },
        ],
      },
    ];
  }
</script>

<!-- Where the title and actions don't fit side by side, on a phone, the actions go under the title. -->
<header class="bar list-bar" bind:this={header}>
  {#if folderId === undefined}
    <h1>Songs</h1>
  {:else}
    <div class="trail">
      <a class="up" class:drop-target={dragging.aimsAt(null)} href={topHref} {...songTarget(null)}>Songs</a>
      <span class="separator" aria-hidden="true">/</span>
      <span class="name">
        <h1>{folder?.name ?? (folderMissing ? 'Not found' : 'Folder')}</h1>
        {#if folder}
          <ActionsMenu label="More actions for {folder.name}" entries={folderActions(folder)} align="start" />
        {/if}
      </span>
    </div>
  {/if}
  {#if !folderMissing}
    <div class="actions">
      <a class="button" href={importHref}>Import</a>
      {#if folderId === undefined}
        <!-- On the narrowest phones it's only its icon, for the three to fit. -->
        <button
          type="button"
          class="button"
          aria-label="New folder"
          title="New folder"
          onclick={() => (newFolder = { for: null })}
          ><span class="narrow" aria-hidden="true"><FolderPlus /></span><span class="wide">New folder</span></button
        >
      {/if}
      <button type="button" class="button primary" disabled={creating} onclick={createSong}>
        {creating ? 'Creating…' : 'New Song'}
      </button>
    </div>
  {/if}
</header>

<main class="page">
  {#if createError}
    <p class="error" role="alert">{createError}</p>
  {/if}
  {#if moveError}
    <p class="error" role="alert">{moveError}</p>
  {/if}
  {#if folderError}
    <p class="error" role="alert">{folderError}</p>
  {/if}
  {#if anySongs && !folderMissing}
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
      <div class="filter-bar" role="group" aria-label="Filter Songs">
        <FilterButton name="Status" label={statusFilterLabel(view.statuses)} picked={view.statuses.length > 0}>
          <fieldset class="choice-group">
            <legend class="visually-hidden">Status</legend>
            {#each statuses as s (s)}
              <label class="choice-row status-choice">
                <input
                  type="checkbox"
                  checked={view.statuses.includes(s)}
                  onchange={(e) => pickStatus(s, e.currentTarget.checked)}
                />
                {s}
              </label>
            {/each}
          </fieldset>
        </FilterButton>
        <button
          type="button"
          class="chip"
          aria-pressed={view.hasMaster}
          onclick={() => (view.hasMaster = !view.hasMaster)}
        >
          Has a Master
        </button>
      </div>
    </search>
  {/if}

  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if songs === null || folders === null}
    <p class="muted">Loading…</p>
  {:else if folderMissing}
    <div class="empty">
      <p>This Folder doesn't exist.</p>
      <a class="button" href="/">Go to Songs</a>
    </div>
  {:else if !anySongs && listedFolders.length === 0}
    <div class="empty">
      {#if folderId === undefined}
        <p>No Songs yet.</p>
        <button type="button" class="button primary" disabled={creating} onclick={createSong}>
          {creating ? 'Creating…' : 'Write your first Song'}
        </button>
      {:else}
        <p>No Songs in this Folder yet.</p>
        <button type="button" class="button primary" disabled={creating} onclick={createSong}>
          {creating ? 'Creating…' : 'Write one'}
        </button>
      {/if}
      <a class="button" href={importHref}>Import one</a>
    </div>
  {:else if sorted}
    {#if listedFolders.length > 0 || sorted.length > 0}
      <table class="songs-table" class:draggable={dragging.on} {@attach dragging.stopTouchScrolling}>
        <thead>
          <tr>
            {#each columns as column (column.id)}
              <th
                class:num={column.num}
                aria-sort={view.sort.column === column.id
                  ? view.sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined}
              >
                <button type="button" onclick={() => (view.sort = toggleSort(view.sort, column.id))}>
                  {column.label}<span class="arrow" aria-hidden="true"
                    >{#if view.sort.column === column.id}{#if view.sort.direction === 'asc'}<ArrowUp />{:else}<ArrowDown
                        />{/if}{/if}</span
                  >
                </button>
              </th>
              {#if column.id === 'title' && acrossFolders}
                <th class="unsorted">Folder</th>
              {/if}
            {/each}
            <th class="row-actions"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each listedFolders as f (f.id)}
            <tr
              class="folder"
              class:drop-target={dragging.aimsAt(f.id)}
              onclick={(event) => openRow(event, folderHref(f))}
              {...songTarget(f.id)}
            >
              <td class="title">
                <span class="with-cover">
                  <span class="folder-icon" aria-hidden="true"><FolderIcon /></span>
                  <a href={folderHref(f)}>{f.name}</a>
                </span>
              </td>
              <td class="muted" colspan="5">{songCount(f.songs)}</td>
              <td class="row-actions">
                <ActionsMenu label="More actions for {f.name}" entries={folderActions(f)} />
              </td>
            </tr>
          {/each}
          {#each sorted as song (song.id)}
            {@const folderName = song.folderId === null ? undefined : folderNames.get(song.folderId)}
            <tr
              class:dragged={dragging.drags(song)}
              onclick={(event) => openRow(event, `/songs/${song.id}`)}
              {...dragging.row(song)}
            >
              <td class="title">
                <span class="with-cover">
                  <SongCover songId={song.id} coverId={song.coverId} title={song.title} status={song.status} />
                  <a href="/songs/{song.id}">{song.title}</a>
                </span>
              </td>
              {#if acrossFolders}
                <td class="folder-name" title={folderName}>{folderName ?? '—'}</td>
              {/if}
              <td><StatusBadge status={song.status} /></td>
              <td>{song.key || '—'}</td>
              <td class="num">{song.bpm ?? '—'}</td>
              <td>
                {#if song.hasMaster}<Check /><span class="visually-hidden">Has a Master</span>{:else}—{/if}
              </td>
              <td class="muted"><time datetime={song.updatedAt}>{timeAgo(song.updatedAt)}</time></td>
              <td class="row-actions">
                <ActionsMenu label="More actions for {song.title}" entries={songActions(song)} />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <ul class="songs" class:draggable={dragging.on} {@attach dragging.stopTouchScrolling}>
        {#each listedFolders as f (f.id)}
          <li class:drop-target={dragging.aimsAt(f.id)} {...songTarget(f.id)}>
            <a href={folderHref(f)}>
              <span class="folder-icon" aria-hidden="true"><FolderIcon /></span>
              <span class="title">{f.name}</span>
              <span class="meta">{songCount(f.songs)}</span>
            </a>
            <ActionsMenu label="More actions for {f.name}" entries={folderActions(f)} />
          </li>
        {/each}
        {#each sorted as song (song.id)}
          {@const folderName = song.folderId === null ? undefined : folderNames.get(song.folderId)}
          <li class:dragged={dragging.drags(song)} {...dragging.row(song)}>
            <a href="/songs/{song.id}">
              <SongCover songId={song.id} coverId={song.coverId} title={song.title} status={song.status} />
              <span class="heading">
                <span class="title">{song.title}</span>
                {#if acrossFolders && folderName !== undefined}
                  <span class="in-folder"
                    ><FolderIcon /><span class="visually-hidden">In</span>
                    {folderName}</span
                  >
                {/if}
              </span>
              <span class="meta">
                <StatusBadge status={song.status} />
                <time datetime={song.updatedAt}>{timeAgo(song.updatedAt)}</time>
              </span>
            </a>
            <ActionsMenu label="More actions for {song.title}" entries={songActions(song)} />
          </li>
        {/each}
      </ul>
    {/if}
    {#if sorted.length === 0 && anySongs && filtered}
      <div class="empty">
        <p>No Songs match.</p>
        <button type="button" class="button" onclick={clearFilters}>Clear filters</button>
      </div>
    {/if}
  {/if}
</main>

{#if dragging.current}
  <!-- The Song being dragged, beside the pointer, clear of the finger: above
       it, or over the header, where there's no room above, below it. -->
  <div
    class="drag-ghost"
    class:below={dragging.current.y < (header?.getBoundingClientRect().bottom ?? 0)}
    aria-hidden="true"
    style:left="{dragging.current.x}px"
    style:top="{dragging.current.y}px"
  >
    {dragging.current.song.title}
  </div>
{/if}

{#if newFolder}
  <FolderNameDialog onSaved={madeFolder} onClose={() => (newFolder = null)} />
{/if}
{#if renaming}
  <FolderNameDialog folder={renaming} onSaved={() => changes++} onClose={() => (renaming = null)} />
{/if}
{#if deleting}
  <DeleteFolderDialog
    folder={deleting}
    onDeleted={() => deleting && deletedFolder(deleting)}
    onFailed={() => changes++}
    onClose={() => (deletingId = null)}
  />
{/if}

<style>
  .list-bar {
    flex-wrap: wrap;
    row-gap: var(--space-2);
  }
  .list-bar > h1 {
    flex-shrink: 0;
  }
  .trail {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0 var(--space-2);
    min-width: 0;
  }
  .trail h1 {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* The Folder's ⋯ stays beside its name, however long. */
  .name {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  /* The way back to all Songs, as big as the Folder's name it leads up from. */
  .up,
  .separator {
    color: var(--text-muted);
    font-size: var(--text-2xl);
    font-weight: 600;
  }
  .up {
    text-decoration: none;
  }
  .up:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .up.drop-target {
    border-radius: var(--radius-sm);
    color: var(--text);
  }

  /* Dragging a Song: where it would drop is ringed, and the Song itself
     follows the pointer, its row faded. */
  /* Over a row's own hover. */
  .drop-target,
  :is(.songs li, tbody tr).drop-target {
    box-shadow: var(--selected-outline);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .dragged {
    opacity: 0.5;
  }
  .drag-ghost {
    position: fixed;
    z-index: 10;
    max-width: 16rem;
    overflow: hidden;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    box-shadow: var(--shadow-float);
    font-size: var(--text-md);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
    transform: translate(var(--space-3), calc(-100% - var(--space-3)));
  }
  .drag-ghost.below {
    transform: translate(var(--space-3), var(--space-6));
  }
  :global(.dragging-song) :is(tbody tr, .up) {
    cursor: grabbing;
  }
  /* A finger held on a Song drags it, rather than selecting its text or
     opening the browser's menu for its link. */
  .draggable :is(li, tr) {
    -webkit-touch-callout: none;
    user-select: none;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-left: auto;
    white-space: nowrap;
  }
  .wide {
    display: none;
  }
  .narrow {
    display: flex;
    font-size: var(--text-lg);
  }
  @media (min-width: 24rem) {
    .wide {
      display: inline;
    }
    .narrow {
      display: none;
    }
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    min-width: 0;
  }
  .filter-bar > .chip {
    flex-shrink: 0;
  }
  .status-choice {
    padding-inline-end: var(--space-2);
    text-transform: capitalize;
  }
  .songs {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--border);
  }
  .songs li {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border);
  }
  .songs a {
    display: flex;
    flex: 1;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-2) var(--space-1);
    color: inherit;
    text-decoration: none;
  }
  .songs li:hover,
  .songs li:focus-within {
    background: var(--surface-1);
  }
  /* A Folder stands where a Song's Cover does. */
  .folder-icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: var(--cover-list);
    height: var(--cover-list);
    color: var(--text-muted);
    font-size: var(--text-xl);
  }
  .title {
    font-weight: 600;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* A Song's title, over its Folder's name while the list looks in every Folder. */
  .heading {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .songs > li > a > .title {
    flex: 1;
  }
  .in-folder {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .in-folder :global(.lucide-icon) {
    flex-shrink: 0;
  }
  /* On the narrowest phones, a Song's Status stands over when it was edited,
     leaving its title room beside them and its ⋯. */
  .meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-1);
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  @media (min-width: 24rem) {
    .meta {
      flex-direction: row;
      align-items: center;
      gap: var(--space-2);
    }
  }
  .empty {
    text-align: center;
    padding: var(--space-8) 0;
  }

  /* Desktop shows a table, narrower windows the list. */
  .songs-table {
    display: none;
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-md);
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
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: inherit;
    cursor: pointer;
  }
  th button:hover,
  th[aria-sort] button {
    color: var(--text);
  }
  /* A column that doesn't sort, headed like one that does. */
  th.unsorted {
    padding: 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  td.folder-name {
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .arrow {
    display: inline-block;
    width: 1em;
    margin-left: var(--space-1);
  }
  /* Rows fit the Cover with some room around it. */
  td {
    height: calc(var(--cover-list) + 0.75rem);
    padding: 0 var(--space-2);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  td.title {
    width: 100%;
    max-width: 0;
    overflow: hidden;
    font-weight: 600;
  }
  td.row-actions {
    padding: 0;
  }
  .with-cover {
    display: flex;
    align-items: center;
    gap: var(--space-3);
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
