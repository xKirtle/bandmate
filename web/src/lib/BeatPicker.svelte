<script lang="ts">
  import { onMount } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { api, type Beat, type DecodedAudio, type Song } from './api';
  import BeatFields from './BeatFields.svelte';
  import BeatFilters from './BeatFilters.svelte';
  import { fromDraft, toDraft, type BeatDraft } from './beatDraft';
  import {
    defaultBeatListView,
    filterBeats,
    isBeatListFiltered,
    songBeatHint,
    sortBeats,
    toggleSort,
    type BeatColumn,
  } from './listViews';
  import { formatDuration, timeAgo } from './time';
  import { suggestForFile } from './beatTags';
  import { prepareUpload } from './upload';

  // Picks a Beat to add to a Song: one from the Beat Library, found with the
  // Library's search, filters and sort, or a new upload, which joins the
  // Library first. The Song's BPM and key show as a hint but are never
  // applied.
  let {
    song,
    onPick,
    onClose,
  }: { song: Pick<Song, 'bpm' | 'key'>; onPick: (beat: Beat) => void; onClose: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  // The whole Library, loaded once and narrowed down here.
  let beats = $state<Beat[] | null>(null);
  let loadError = $state<string | null>(null);
  let maxUploadBytes = $state(Infinity);
  // The picker's own view, starting plain each time: it's a dialog on the
  // Song page, so it stays out of the URL and the Library's view.
  let view = $state({ ...defaultBeatListView });

  // A file being uploaded: decoded, waiting for its details.
  let adding = $state<{ file: File; decoded: DecodedAudio; draft: BeatDraft } | null>(null);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  onMount(() => dialog?.showModal());

  api.getConfig().then(
    (c) => (maxUploadBytes = c.maxUploadBytes),
    // The server still enforces its limit.
    () => {},
  );

  api.listBeats().then(
    (list) => (beats = list),
    (e: Error) => (loadError = e.message),
  );

  const shown = $derived(beats && sortBeats(filterBeats(beats, view), view.sort));
  const hint = $derived(songBeatHint(song));

  function clearFilters() {
    view = { ...defaultBeatListView, sort: view.sort };
  }

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

  const sortState = (column: BeatColumn) =>
    view.sort.column === column ? (view.sort.direction === 'asc' ? 'ascending' : 'descending') : undefined;

  function pickRow(event: MouseEvent, beat: Beat) {
    // The title's button picks on its own.
    if ((event.target as Element).closest('button')) return;
    onPick(beat);
  }

  function facts(beat: Beat): string {
    return [beat.producer, beat.bpm ? `${beat.bpm} BPM` : '', beat.key, formatDuration(beat.duration)]
      .filter(Boolean)
      .join(' · ');
  }

  async function pickFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    adding = null;
    error = null;
    busy = `Reading “${file.name}”…`;
    try {
      const [decoded, suggestion] = await Promise.all([prepareUpload(file, maxUploadBytes), suggestForFile(file)]);
      adding = { file, decoded, draft: toDraft(suggestion) };
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = null;
    }
  }

  async function upload(event: SubmitEvent) {
    event.preventDefault();
    if (!adding) return;
    const details = fromDraft(adding.draft);
    if (typeof details === 'string') {
      error = details;
      return;
    }
    busy = 'Uploading…';
    error = null;
    try {
      onPick(await api.addBeat(adding.file, details, adding.decoded));
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = null;
    }
  }
</script>

<dialog bind:this={dialog} onclose={onClose} aria-labelledby="beat-picker-heading">
  <header>
    <h2 id="beat-picker-heading">Add a beat</h2>
    <button type="button" class="icon" onclick={() => dialog?.close()} aria-label="Close">✕</button>
  </header>

  {#if adding}
    <form class="adding" onsubmit={upload}>
      <p class="file">
        “{adding.file.name}” <span class="muted">{formatDuration(adding.decoded.duration)}</span>
      </p>
      <BeatFields bind:draft={adding.draft} idPrefix="picker-beat" />
      <div class="actions">
        <button type="submit" class="button primary" disabled={busy !== null}>Add to Library and Song</button>
        <button type="button" class="button" onclick={() => (adding = null)} disabled={busy !== null}>Back</button>
      </div>
    </form>
  {:else}
    <BeatFilters bind:view beats={beats ?? []} idPrefix="beat-picker" {hint}>
      {#snippet actions()}
        <label class="button upload" class:disabled={busy !== null}>
          Upload new
          <input class="visually-hidden" type="file" accept="audio/*" onchange={pickFile} disabled={busy !== null} />
        </label>
      {/snippet}
    </BeatFilters>

    {#if loadError}
      <p class="error" role="alert">{loadError}</p>
    {:else if beats === null || shown === null}
      <p class="muted">Loading…</p>
    {:else if beats.length === 0}
      <p class="muted empty">The Beat Library is empty. Upload a beat to start.</p>
    {:else if shown.length === 0 && isBeatListFiltered(view)}
      <div class="empty">
        <p class="muted">No Beats match.</p>
        <button type="button" class="button" onclick={clearFilters}>Clear filters</button>
      </div>
    {:else if desktop.current}
      <table class="beats-table">
        <thead>
          <tr>
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
            <tr onclick={(event) => pickRow(event, beat)}>
              <td class="title">
                <button type="button" onclick={() => onPick(beat)}>{beat.title}</button>
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
    {:else}
      <ul class="beats">
        {#each shown as beat (beat.id)}
          <li>
            <button type="button" onclick={() => onPick(beat)}>
              <span class="title">{beat.title}</span>
              <span class="muted">{facts(beat)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  {#if busy}
    <p class="muted" role="status">{busy}</p>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</dialog>

<style>
  dialog {
    width: min(36rem, calc(100vw - 2rem));
    max-height: min(40rem, calc(100vh - 2rem));
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--bg);
    color: var(--text);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  h2 {
    margin: 0;
    font-size: 1.125rem;
  }
  .upload {
    flex-shrink: 0;
  }
  .upload.disabled {
    opacity: 0.6;
    cursor: default;
  }
  .upload:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .beats {
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--border);
  }
  .beats li {
    border-bottom: 1px solid var(--border);
  }
  .beats button {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: var(--control);
    padding: 0.5rem 0.25rem;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .beats button:hover {
    background: var(--surface-1);
  }
  .title {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .beats .muted {
    font-size: 0.8125rem;
  }
  .empty {
    padding: 1.5rem 0;
    text-align: center;
  }
  .empty p {
    margin-top: 0;
  }
  .adding {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .file {
    margin: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .file span {
    font-weight: 400;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* Desktop has room for the Library's table, sorted by its headers. The
     dialog keeps its height as filters narrow the Beats down. */
  @media (min-width: 80rem) {
    dialog {
      width: min(64rem, calc(100vw - 4rem));
      height: min(48rem, calc(100vh - 4rem));
      max-height: none;
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
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
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
</style>
