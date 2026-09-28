<script lang="ts">
  import { untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { api, type Beat, type DecodedAudio } from '../lib/api';
  import BeatFields from '../lib/BeatFields.svelte';
  import BeatItem from '../lib/BeatItem.svelte';
  import { fromDraft, toDraft, type BeatDraft } from '../lib/beatDraft';
  import {
    beatKeys,
    beatListViewFromParams,
    beatListViewToParams,
    beatProducers,
    defaultBeatListView,
    filterBeats,
    isBeatListFiltered,
    sortBeats,
    toggleSort,
    type BeatColumn,
    type BeatUse,
  } from '../lib/listViews';
  import { playMediaAlone } from '../lib/playback';
  import { canSetVolume, playerVolume } from '../lib/playerVolume.svelte';
  import { replaceSearch, router } from '../lib/router.svelte';
  import { formatDuration, timeAgo } from '../lib/time';
  import { suggestForFile } from '../lib/beatTags';
  import { prepareUpload } from '../lib/upload';
  import { gain } from '../lib/volume';

  // The whole Library, loaded once and narrowed down here.
  let beats = $state<Beat[] | null>(null);
  let loadError = $state<string | null>(null);
  // The search, filters and sort start as the URL has them, and are kept in
  // it so going back to the Library restores them. The filters combine.
  let view = $state(beatListViewFromParams(new URLSearchParams(router.search)));
  // Bumped to load the list again, e.g. after adding a Beat.
  let reloads = $state(0);
  let maxUploadBytes = $state(Infinity);

  // A file being added: decoded, waiting for its details.
  interface Adding {
    file: File;
    decoded: DecodedAudio;
    draft: BeatDraft;
  }
  let adding = $state<Adding | null>(null);
  let addBusy = $state<string | null>(null);
  let addError = $state<string | null>(null);

  api.getConfig().then(
    (c) => (maxUploadBytes = c.maxUploadBytes),
    // The server still enforces its limit.
    () => {},
  );

  // Only the latest request's answer is shown.
  $effect(() => {
    void reloads;
    let current = true;
    api.listBeats().then(
      (list) => {
        if (!current) return;
        beats = list;
        loadError = null;
      },
      (e: Error) => current && (loadError = e.message),
    );
    return () => {
      current = false;
    };
  });

  $effect(() => {
    replaceSearch(beatListViewToParams(view));
  });

  const shown = $derived(beats && sortBeats(filterBeats(beats, view), view.sort));
  const filtering = $derived(isBeatListFiltered(view));
  const producers = $derived(withChosen(beatProducers(beats ?? []), view.producer));
  const keys = $derived(withChosen(beatKeys(beats ?? []), view.key));

  /** The choices for a filter, keeping the chosen one even if no Beat has it now. */
  function withChosen(choices: string[], chosen: string | undefined): string[] {
    return chosen && !choices.some((c) => c.toLowerCase() === chosen.trim().toLowerCase())
      ? [chosen, ...choices]
      : choices;
  }

  function clearFilters() {
    view = { ...defaultBeatListView, sort: view.sort };
  }

  // How many of the filters other than the search are set. Below 80rem they
  // sit in a drawer, which starts closed unless one is.
  const drawerCount = $derived(
    [view.producer?.trim(), view.bpmMin !== undefined || view.bpmMax !== undefined, view.key?.trim(), view.use].filter(
      Boolean,
    ).length,
  );
  let drawerOpen = $state(untrack(() => drawerCount > 0));

  function setBpm(end: 'bpmMin' | 'bpmMax', event: Event) {
    const bpm = (event.currentTarget as HTMLInputElement).valueAsNumber;
    view[end] = Number.isFinite(bpm) && bpm >= 0 ? bpm : undefined;
  }

  const uses: { id: BeatUse | undefined; label: string }[] = [
    { id: undefined, label: 'All' },
    { id: 'used', label: 'Used' },
    { id: 'unused', label: 'Not used' },
  ];

  const desktop = new MediaQuery('min-width: 80rem');

  const columns: { id: BeatColumn; label: string; num?: boolean }[] = [
    { id: 'title', label: 'Title' },
    { id: 'producer', label: 'Producer' },
    { id: 'bpm', label: 'BPM', num: true },
    { id: 'key', label: 'Key' },
    { id: 'duration', label: 'Duration', num: true },
    { id: 'usedBy', label: 'Used by' },
    { id: 'added', label: 'Added' },
  ];

  // The table previews Beats through one player, which follows the volume
  // every Master and Beat preview shares and stops whatever else plays.
  let preview = $state<HTMLAudioElement>();
  let previewing = $state<number | null>(null);
  const volume = $derived(playerVolume.value);

  $effect(() => {
    if (!preview) return;
    preview.muted = volume.muted;
    if (canSetVolume()) preview.volume = gain(volume.level);
  });

  function togglePreview(beat: Beat) {
    if (!preview) return;
    if (previewing === beat.id) {
      preview.pause();
      return;
    }
    preview.src = api.beatAudioUrl(beat);
    previewing = beat.id;
    // A later Beat's play() cuts this one short, and that Beat is previewing now.
    preview.play().catch(() => previewing === beat.id && (previewing = null));
  }

  async function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    adding = null;
    addError = null;
    addBusy = `Reading “${file.name}”…`;
    try {
      const [decoded, suggestion] = await Promise.all([prepareUpload(file, maxUploadBytes), suggestForFile(file)]);
      adding = { file, decoded, draft: toDraft(suggestion) };
    } catch (e) {
      addError = (e as Error).message;
    } finally {
      addBusy = null;
    }
  }

  async function add(event: SubmitEvent) {
    event.preventDefault();
    if (!adding) return;
    const details = fromDraft(adding.draft);
    if (typeof details === 'string') {
      addError = details;
      return;
    }
    addBusy = 'Uploading…';
    addError = null;
    try {
      await api.addBeat(adding.file, details, adding.decoded);
      adding = null;
      reloads++;
    } catch (e) {
      addError = (e as Error).message;
    } finally {
      addBusy = null;
    }
  }

  function cancelAdd() {
    adding = null;
    addError = null;
  }

  // On desktop, the Beat open in the pane beside the table. It stays open
  // while filters hide its row, so editing a credit doesn't close it.
  let openId = $state<number | null>(null);
  const openBeat = $derived((desktop.current && beats?.find((b) => b.id === openId)) || null);
  // The sticky header's height, which the sticky pane stays below.
  let barHeight = $state(0);

  function openRow(event: MouseEvent, beat: Beat) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((event.target as Element).closest('button, a')) return;
    toggleOpen(beat);
  }

  function toggleOpen(beat: Beat) {
    openId = openId === beat.id ? null : beat.id;
  }

  /** Closes the pane, handing focus back to its row. */
  function closePane() {
    const id = openId;
    openId = null;
    document.getElementById(`beat-row-${id}`)?.focus();
  }

  function closeOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !openBeat || event.defaultPrevented) return;
    // Esc in a field is the field's, e.g. clearing the search.
    if ((event.target as Element).closest('input, textarea, select')) return;
    closePane();
  }

  function showChanged(beat: Beat) {
    beats = beats?.map((b) => (b.id === beat.id ? beat : b)) ?? null;
  }

  function dropDeleted(id: number) {
    beats = beats?.filter((b) => b.id !== id) ?? null;
    if (openId === id) openId = null;
  }

  const sortState = (column: BeatColumn) =>
    view.sort.column === column ? (view.sort.direction === 'asc' ? 'ascending' : 'descending') : undefined;
</script>

<svelte:window onkeydown={closeOnEscape} />

<header class="bar" bind:clientHeight={barHeight}>
  <h1>Beats</h1>
  <label class="button primary" class:disabled={addBusy !== null}>
    Add Beat
    <input class="visually-hidden" type="file" accept="audio/*" onchange={pick} disabled={addBusy !== null} />
  </label>
</header>

<main class="page" style:--bar-height="{barHeight}px">
  {#if adding}
    <form class="adding" onsubmit={add} aria-labelledby="adding-heading">
      <h2 id="adding-heading">
        Add “{adding.file.name}”
        <span class="muted">{formatDuration(adding.decoded.duration)}</span>
      </h2>
      <BeatFields bind:draft={adding.draft} idPrefix="new-beat" />
      <div class="actions">
        <button type="submit" class="button primary" disabled={addBusy !== null}>Add to Library</button>
        <button type="button" class="button" onclick={cancelAdd} disabled={addBusy !== null}>Cancel</button>
      </div>
    </form>
  {/if}
  {#if addBusy}
    <p class="muted" role="status">{addBusy}</p>
  {/if}
  {#if addError}
    <p class="error add-error" role="alert">{addError}</p>
  {/if}

  <audio bind:this={preview} onplay={playMediaAlone} onpause={() => (previewing = null)} hidden></audio>

  <search class="filters">
    <div class="search-row">
      <label class="visually-hidden" for="beat-search">Search Beats by title or producer</label>
      <input
        id="beat-search"
        type="search"
        bind:value={view.q}
        placeholder="Search titles and producers"
        autocomplete="off"
        enterkeyhint="search"
      />
      <button
        type="button"
        class="button drawer-toggle"
        aria-expanded={drawerOpen}
        aria-controls="beat-filters"
        onclick={() => (drawerOpen = !drawerOpen)}
      >
        Filters{#if drawerCount > 0}<span class="count">{drawerCount}</span>{/if}
      </button>
    </div>
    <div id="beat-filters" class="drawer" class:open={drawerOpen}>
      <label class="field">
        <span>Producer</span>
        <select
          value={view.producer ?? ''}
          onchange={(e) => (view.producer = e.currentTarget.value || undefined)}
        >
          <option value="">Any</option>
          {#each producers as p (p)}
            <option value={p}>{p}</option>
          {/each}
        </select>
      </label>
      <fieldset class="field bpm">
        <legend>BPM</legend>
        <label class="visually-hidden" for="beat-bpm-min">Lowest BPM</label>
        <input
          id="beat-bpm-min"
          type="number"
          inputmode="decimal"
          min="0"
          placeholder="From"
          value={view.bpmMin ?? ''}
          oninput={(e) => setBpm('bpmMin', e)}
        />
        <span aria-hidden="true">–</span>
        <label class="visually-hidden" for="beat-bpm-max">Highest BPM</label>
        <input
          id="beat-bpm-max"
          type="number"
          inputmode="decimal"
          min="0"
          placeholder="To"
          value={view.bpmMax ?? ''}
          oninput={(e) => setBpm('bpmMax', e)}
        />
      </fieldset>
      <label class="field">
        <span>Key</span>
        <select value={view.key ?? ''} onchange={(e) => (view.key = e.currentTarget.value || undefined)}>
          <option value="">Any</option>
          {#each keys as k (k)}
            <option value={k}>{k}</option>
          {/each}
        </select>
      </label>
      <div class="chips" role="group" aria-label="Used in a Song">
        {#each uses as u (u.label)}
          <button type="button" class="chip" aria-pressed={view.use === u.id} onclick={() => (view.use = u.id)}>
            {u.label}
          </button>
        {/each}
      </div>
    </div>
  </search>

  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if beats === null || shown === null}
    <p class="muted">Loading…</p>
  {:else if beats.length === 0}
    <div class="empty">
      <p>No Beats yet. Add an audio file to use it in any Song.</p>
    </div>
  {:else if shown.length === 0 && filtering}
    <div class="empty">
      <p>No Beats match.</p>
      <button type="button" class="button" onclick={clearFilters}>Clear filters</button>
    </div>
  {:else if desktop.current}
    <div class="table-and-pane" class:with-pane={openBeat}>
      <table class="beats-table">
        <thead>
          <tr>
            <th class="play"><span class="visually-hidden">Preview</span></th>
            {#each columns as column (column.id)}
              <th class:num={column.num} aria-sort={sortState(column.id)}>
                <button type="button" onclick={() => (view.sort = toggleSort(view.sort, column.id))}>
                  {column.label}<span class="arrow" aria-hidden="true"
                    >{{ ascending: '↑', descending: '↓', none: '' }[sortState(column.id) ?? 'none']}</span
                  >
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each shown as beat (beat.id)}
            <tr class:open={beat.id === openId} onclick={(event) => openRow(event, beat)}>
              <td class="play">
                <button
                  type="button"
                  class="icon"
                  aria-label="{previewing === beat.id ? 'Pause' : 'Preview'} {beat.title}"
                  onclick={() => togglePreview(beat)}
                >
                  {previewing === beat.id ? '❚❚' : '▶'}
                </button>
              </td>
              <td class="title">
                <button
                  type="button"
                  id="beat-row-{beat.id}"
                  aria-expanded={beat.id === openId}
                  aria-controls={beat.id === openId ? 'beat-pane' : undefined}
                  onclick={() => toggleOpen(beat)}>{beat.title}</button
                >
              </td>
              <td>{beat.producer || '—'}</td>
              <td class="num">{beat.bpm ?? '—'}</td>
              <td>{beat.key || '—'}</td>
              <td class="num">{formatDuration(beat.duration)}</td>
              <td class="used-by">{beat.songs.map((s) => s.title).join(', ') || '—'}</td>
              <td class="muted"><time datetime={beat.createdAt}>{timeAgo(beat.createdAt)}</time></td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if openBeat}
        <aside id="beat-pane" class="pane" aria-label="Beat details">
          <button type="button" class="icon close" aria-label="Close Beat details" onclick={closePane}>×</button>
          {#key openBeat.id}
            <BeatItem beat={openBeat} {maxUploadBytes} onChange={showChanged} onDelete={dropDeleted} />
          {/key}
        </aside>
      {/if}
    </div>
  {:else}
    <div class="beats">
      {#each shown as beat (beat.id)}
        <BeatItem {beat} {maxUploadBytes} onChange={showChanged} onDelete={dropDeleted} />
      {/each}
    </div>
  {/if}
</main>

<style>
  .bar label.disabled {
    opacity: 0.6;
    cursor: default;
  }
  .bar label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .adding {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-1);
  }
  .adding h2 {
    margin: 0;
    font-size: 1rem;
    overflow-wrap: anywhere;
  }
  .adding h2 span {
    font-weight: 400;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  .add-error {
    margin-bottom: 1rem;
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .search-row {
    display: flex;
    gap: 0.5rem;
  }
  .search-row input {
    flex: 1;
  }
  .drawer-toggle {
    flex-shrink: 0;
    gap: 0.375rem;
  }
  .count {
    min-width: 1.25rem;
    padding: 0 0.375rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 0.75rem;
    line-height: 1.25rem;
  }
  .drawer {
    display: none;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-1);
  }
  .drawer.open {
    display: flex;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 8rem;
    margin: 0;
    padding: 0;
    border: none;
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .field select {
    color: var(--text);
    font-weight: 400;
  }
  .bpm {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }
  .bpm legend {
    width: 100%;
    margin-bottom: 0.25rem;
    padding: 0;
  }
  .bpm input {
    width: 5.5rem;
    color: var(--text);
    font-weight: 400;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip {
    min-height: var(--control);
    padding: 0 1rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }
  .chip[aria-pressed='true'] {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  /* Desktop has room for every filter beside the search, with no drawer. */
  @media (min-width: 80rem) {
    .filters {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: end;
      gap: 0.75rem;
    }
    .search-row {
      flex: 1 1 16rem;
    }
    .drawer-toggle {
      display: none;
    }
    .drawer {
      display: flex;
      padding: 0;
      border: none;
      background: none;
    }
    .chip {
      background: var(--surface-1);
    }
  }

  .beats-table {
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
  td {
    height: calc(var(--control) + 0.5rem);
    padding: 0 0.5rem;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  td.title {
    width: 100%;
    max-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
  }
  td.title button {
    all: unset;
    cursor: pointer;
  }
  td.title button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  td.used-by {
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .play {
    width: calc(var(--control) + 0.5rem);
    padding: 0 0.25rem;
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
  tbody tr.open {
    background: var(--surface-2);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  /* The open Beat's pane sits beside the table, the width of the Song page's
     right column. It sticks below the header, scrolling on its own, while the
     table scrolls. */
  .table-and-pane {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: var(--gutter);
  }
  .table-and-pane.with-pane {
    grid-template-columns: minmax(0, 1fr) 22rem;
  }
  .pane {
    position: sticky;
    top: var(--bar-height);
    max-height: calc(100dvh - var(--bar-height) - var(--gutter));
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.5rem 1rem 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-1);
  }
  .close {
    float: right;
    margin-left: 0.5rem;
  }
  .pane :global(.beat) {
    border-bottom: none;
  }
  .beats {
    border-top: 1px solid var(--border);
  }
  .empty {
    text-align: center;
    padding: 3rem 0;
  }
</style>
