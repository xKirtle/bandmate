<script lang="ts">
  import Pause from '@lucide/svelte/icons/pause';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Play from '@lucide/svelte/icons/play';
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { api, type Beat, type DecodedAudio } from '../lib/api';
  import BeatBatch from '../lib/BeatBatch.svelte';
  import type { BatchRow } from '../lib/beatBatch';
  import type { Preview } from '../lib/beatPreview';
  import BeatFields from '../lib/BeatFields.svelte';
  import BeatFilters from '../lib/BeatFilters.svelte';
  import BeatEditDialog from '../lib/BeatEditDialog.svelte';
  import BeatItem from '../lib/BeatItem.svelte';
  import BeatPlayerBar from '../lib/BeatPlayerBar.svelte';
  import BeatTable from '../lib/BeatTable.svelte';
  import { fromDraft, toDraft, type BeatDraft } from '../lib/beatDraft';
  import {
    beatListViewFromParams,
    beatListViewToParams,
    defaultBeatListView,
    filterBeats,
    isBeatListFiltered,
    sortBeats,
  } from '../lib/listViews';
  import { replaceSearch, router } from '../lib/router.svelte';
  import { formatDuration } from '../lib/time';
  import { suggestForFile } from '../lib/beatTags';
  import { prepareUpload } from '../lib/upload';
  import { draggedFiles } from '../lib/fileDrop';
  import { audioDropped, entriesDropped, filesIn, skippedNote } from '../lib/droppedFiles';

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
  function clearFilters() {
    view = { ...defaultBeatListView, sort: view.sort };
  }
  // Without any Beats, the search and filters have nothing to act on, so
  // they're hidden, and cleared so ones from the URL don't hide the first
  // Beat once it's added. An effect rather than the load, since deleting the
  // last Beat empties the Library too.
  const anyBeats = $derived(beats === null || beats.length > 0);
  $effect(() => {
    if (!anyBeats && filtering) clearFilters();
  });

  const desktop = new MediaQuery('min-width: 80rem');

  // On desktop, the table previews Beats through the bar at the bottom, which
  // keeps the last Beat previewed until the Beat is deleted, the window narrows
  // or the page is left. The batch's rows preview their files through it too,
  // until the row leaves the batch.
  type Previewing = { beatId: number } | { row: BatchRow };
  let previewing = $state<Previewing | null>(null);
  const preview = $derived.by((): Preview | null => {
    if (!desktop.current || !previewing) return null;
    if ('row' in previewing) return previewing;
    const { beatId } = previewing;
    const beat = beats?.find((b) => b.id === beatId);
    return beat ? { beat } : null;
  });
  let previewPlaying = $state(false);
  let playerBar = $state<BeatPlayerBar>();
  let playerBarHeight = $state(0);
  // The header's size, unrounded, so the page with the bar fits the window exactly.
  let headerBox = $state<ResizeObserverSize[]>();
  const headerHeight = $derived(headerBox?.[0].blockSize ?? 0);

  const isPreviewing = (target: Previewing) =>
    previewing !== null &&
    ('row' in target
      ? 'row' in previewing && previewing.row.key === target.row.key
      : 'beatId' in previewing && previewing.beatId === target.beatId);

  async function togglePreview(target: Previewing) {
    if (isPreviewing(target) && playerBar) {
      playerBar.toggle();
      return;
    }
    // A new Beat or file starts playing once the bar has loaded it.
    previewing = target;
    await tick();
    playerBar?.play();
  }

  // The bar is desktop's: narrowing the window stops the preview for good,
  // rather than bringing it back when the window widens again.
  $effect(() => {
    if (!desktop.current) closePreview();
  });

  const playingNow = (beat: Beat) => isPreviewing({ beatId: beat.id }) && previewPlaying;
  const previewingRow = $derived(previewing && 'row' in previewing ? previewing.row.key : null);
  const playingRow = $derived(previewPlaying && desktop.current ? previewingRow : null);

  function closePreview() {
    previewing = null;
    previewPlaying = false;
  }

  // A row leaving the batch, removed, added or cancelled, takes its preview with it.
  function dropStaged(key: number) {
    if (previewingRow === key) closePreview();
  }

  // Several files picked at once, on desktop, open a review table instead of
  // the form; files picked while it's open join it.
  let batching = $state(false);
  let batchUploading = $state(false);
  let batch = $state<BeatBatch>();

  function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    dropNote = null;
    addFiles(files);
  }

  /** Opens the form for one file, or the review table for several, or adds them to the table already open. */
  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    if (batching || files.length > 1) {
      adding = null;
      addError = null;
      batching = true;
      await tick();
      batch?.append(files);
      return;
    }
    const [file] = files;
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
      dropNote = null;
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
    dropNote = null;
  }

  // The Beat being edited in the dialog the table opens. The cards below
  // 80rem open their own; this one stays open across a resize, keeping its
  // unsaved changes.
  let editingId = $state<number | null>(null);
  const editingBeat = $derived(beats?.find((b) => b.id === editingId) ?? null);

  // On desktop, audio files and folders can be dropped anywhere on the page,
  // which shows it'll take them while they're dragged over it. They go where
  // picking them would, once those that aren't audio are skipped, which is
  // said. Not while files can't be picked, nor under the edit dialog. A drop
  // the page doesn't take is never opened by the browser in its place.
  const takesFiles = $derived(desktop.current && addBusy === null && !batchUploading && editingBeat === null);
  // Entering one of the page's elements fires before leaving the last, so
  // the drag is over the page until it's left as many times as entered.
  let dragDepth = $state(0);
  const dropTarget = $derived(takesFiles && dragDepth > 0);
  // Said of the last files dropped: how many weren't audio.
  let dropNote = $state<string | null>(null);

  function filesEnter(event: DragEvent) {
    if (draggedFiles(event)) dragDepth++;
  }

  function filesLeave(event: DragEvent) {
    if (draggedFiles(event)) dragDepth = Math.max(0, dragDepth - 1);
  }

  function filesOver(event: DragEvent) {
    const data = draggedFiles(event);
    if (!data) return;
    event.preventDefault();
    data.dropEffect = takesFiles ? 'copy' : 'none';
  }

  async function filesDrop(event: DragEvent) {
    const data = draggedFiles(event);
    if (!data) return;
    event.preventDefault();
    dragDepth = 0;
    if (!takesFiles) return;
    // Asked before the drop is over, which empties it. Reading a folder can
    // take a while, and nothing else can be added meanwhile.
    const entries = entriesDropped(data);
    let files = [...data.files];
    if (entries) {
      addBusy = 'Reading the files dropped…';
      files = await filesIn(entries);
      addBusy = null;
    }
    const { audio, skipped } = audioDropped(files);
    dropNote = skippedNote(skipped);
    addFiles(audio);
  }

  // A batch adds its Beats to the list as each saves, rather than loading
  // the whole Library again for each one.
  function showAdded(beat: Beat) {
    if (beats) beats = [...beats, beat];
    else reloads++;
  }

  function showChanged(beat: Beat) {
    beats = beats?.map((b) => (b.id === beat.id ? beat : b)) ?? null;
  }

  async function dropDeleted(id: number) {
    // Focus goes to the next Beat's Edit, or the one before if it was last,
    // rather than being lost with the deleted Beat's.
    const at = shown?.findIndex((b) => b.id === id) ?? -1;
    const neighbour = shown?.[at + 1] ?? shown?.[at - 1];
    beats = beats?.filter((b) => b.id !== id) ?? null;
    if (editingId === id) editingId = null;
    if (isPreviewing({ beatId: id })) closePreview();
    await tick();
    if (neighbour) document.getElementById(`edit-beat-${neighbour.id}`)?.focus();
  }
</script>

{#snippet editCell(beat: Beat)}
  <button
    type="button"
    id="edit-beat-{beat.id}"
    class="icon edit"
    aria-label="Edit {beat.title}"
    onclick={() => (editingId = beat.id)}
  >
    <Pencil />
  </button>
{/snippet}

{#snippet addBeatButton(text: string)}
  {@const disabled = addBusy !== null || batchUploading}
  <label class="button primary add-beat" class:disabled>
    {text}
    <!-- Below desktop, Beats are added one at a time. -->
    <input class="visually-hidden" type="file" accept="audio/*" multiple={desktop.current} onchange={pick} {disabled} />
  </label>
{/snippet}

{#snippet previewCell(beat: Beat)}
  <button
    type="button"
    class="icon"
    aria-label="{playingNow(beat) ? 'Pause' : 'Preview'} {beat.title}"
    onclick={() => togglePreview({ beatId: beat.id })}
  >
    {#if playingNow(beat)}<Pause />{:else}<Play />{/if}
  </button>
{/snippet}

<svelte:window ondragenter={filesEnter} ondragleave={filesLeave} ondragover={filesOver} ondrop={filesDrop} />

{#if dropTarget}
  <div class="drop-target" aria-hidden="true"><p>Drop audio files or folders to add them as Beats</p></div>
{/if}

<header class="bar" bind:borderBoxSize={headerBox}>
  <h1>Beats</h1>
  {@render addBeatButton('Add Beat')}
</header>

<main
  class="page"
  class:with-player={preview}
  style:--header-height="{headerHeight}px"
  style:--player-height="{playerBarHeight}px"
>
  {#if batching}
    <BeatBatch
      bind:this={batch}
      bind:uploading={batchUploading}
      library={beats}
      {maxUploadBytes}
      {playingRow}
      onPreview={desktop.current ? (row) => togglePreview({ row }) : null}
      onLeave={dropStaged}
      onAdded={showAdded}
      onClose={() => {
        batching = false;
        dropNote = null;
      }}
    />
  {/if}
  {#if adding}
    <form class="adding" onsubmit={add} aria-labelledby="adding-heading">
      <h2 id="adding-heading">
        Add “{adding.file.name}”
        <span class="muted tabular">{formatDuration(adding.decoded.duration)}</span>
      </h2>
      <BeatFields bind:draft={adding.draft} idPrefix="new-beat" />
      <div class="actions">
        <button type="submit" class="button primary" disabled={addBusy !== null}>Add to Library</button>
        <button type="button" class="button" onclick={cancelAdd} disabled={addBusy !== null}>Cancel</button>
      </div>
    </form>
  {/if}
  {#if dropNote}
    <p class="muted skipped" role="status">{dropNote}</p>
  {/if}
  {#if addBusy}
    <p class="muted" role="status">{addBusy}</p>
  {/if}
  {#if addError}
    <p class="error add-error" role="alert">{addError}</p>
  {/if}

  {#if anyBeats}
    <BeatFilters bind:view beats={beats ?? []} idPrefix="beat" />
  {/if}

  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if beats === null || shown === null}
    <p class="muted">Loading…</p>
  {:else if beats.length === 0}
    <div class="empty">
      <p>No Beats yet. Add an audio file to use it in any Song.</p>
      {@render addBeatButton('Add your first Beat')}
    </div>
  {:else if shown.length === 0 && filtering}
    <div class="empty">
      <p>No Beats match.</p>
      <button type="button" class="button" onclick={clearFilters}>Clear filters</button>
    </div>
  {:else if desktop.current}
    <BeatTable
      beats={shown}
      bind:sort={view.sort}
      lead={{ label: 'Preview', cell: previewCell }}
      trail={{ label: 'Edit', cell: editCell }}
      openId={editingBeat?.id ?? null}
    >
      {#snippet title(beat)}
        {beat.title}
      {/snippet}
    </BeatTable>
  {:else}
    <div class="beats">
      {#each shown as beat (beat.id)}
        <BeatItem {beat} {maxUploadBytes} onChange={showChanged} onDelete={dropDeleted} />
      {/each}
    </div>
  {/if}
</main>

{#if editingBeat}
  <BeatEditDialog
    beat={editingBeat}
    {maxUploadBytes}
    onChange={showChanged}
    onDelete={dropDeleted}
    onClose={() => (editingId = null)}
  />
{/if}

{#if preview}
  <BeatPlayerBar bind:this={playerBar} bind:playing={previewPlaying} bind:height={playerBarHeight} {preview} />
{/if}

<style>
  .add-beat.disabled {
    opacity: 0.6;
    cursor: default;
  }
  .add-beat:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .adding {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-6);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .adding h2 {
    margin: 0;
    font-size: var(--text-lg);
    overflow-wrap: anywhere;
  }
  .adding h2 span {
    font-weight: 400;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
  .add-error,
  .skipped {
    margin-bottom: var(--space-4);
  }
  /* The window, nav rail and all, while files dropped anywhere on it would be added. */
  .drop-target {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    box-shadow: var(--selected-outline);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    pointer-events: none;
  }
  .drop-target p {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text);
    font-weight: 600;
  }
  /* With the player docked below, the page reaches at least to it, so the bar
     sits at the bottom of the window even under a short list. */
  .page.with-player {
    min-height: calc(100dvh - var(--header-height) - var(--player-height));
  }
  .beats {
    border-top: 1px solid var(--border);
  }
  .empty {
    text-align: center;
    padding: var(--space-8) 0;
  }
</style>
