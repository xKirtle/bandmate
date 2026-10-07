<script lang="ts">
  import Pause from '@lucide/svelte/icons/pause';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Play from '@lucide/svelte/icons/play';
  import { onDestroy, tick } from 'svelte';
  import AddBeatForm from '../lib/AddBeatForm.svelte';
  import AddFromLink from '../lib/AddFromLink.svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { api, type Beat } from '../lib/api';
  import BeatBatch from '../lib/BeatBatch.svelte';
  import type { BatchRow } from '../lib/beatBatch';
  import type { Preview } from '../lib/beatPreview';
  import BeatFilters from '../lib/BeatFilters.svelte';
  import BeatEditDialog from '../lib/BeatEditDialog.svelte';
  import BeatItem from '../lib/BeatItem.svelte';
  import BeatPlayerBar from '../lib/BeatPlayerBar.svelte';
  import BeatTable from '../lib/BeatTable.svelte';
  import { BeatToAdd, fileReader } from '../lib/beatToAdd.svelte';
  import {
    beatListViewFromParams,
    beatListViewToParams,
    defaultBeatListView,
    filterBeats,
    isBeatListFiltered,
    sortBeats,
  } from '../lib/listViews';
  import { replaceSearch, router } from '../lib/router.svelte';
  import FileDrop from '../lib/FileDrop.svelte';
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

  // The one Beat being added, through the form. Several files go to the
  // batch's review table instead.
  const toAdd = new BeatToAdd(
    fileReader(() => maxUploadBytes),
    api,
  );
  // Reading a folder dropped, before its files go where picking them would.
  let readingDrop = $state(false);
  const addBusy = $derived(toAdd.busy ?? (readingDrop ? 'Reading the files dropped…' : null));
  // Whether Add from link is offered, and whether its box is open.
  let addFromLink = $state(false);
  let linking = $state(false);

  api.getConfig().then(
    (c) => {
      maxUploadBytes = c.maxUploadBytes;
      addFromLink = c.addFromLink;
    },
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
    linking = false;
    if (batching || files.length > 1) {
      toAdd.leave();
      batching = true;
      await tick();
      batch?.append(files);
      return;
    }
    await toAdd.read(files[0]);
  }

  function openLinkBox() {
    toAdd.leave();
    dropNote = null;
    linking = true;
  }

  onDestroy(() => toAdd.close());

  // The Beat being edited in the dialog the table opens. The cards below
  // 80rem open their own; this one stays open across a resize, keeping its
  // unsaved changes.
  let editingId = $state<number | null>(null);
  const editingBeat = $derived(beats?.find((b) => b.id === editingId) ?? null);

  // On desktop, audio files and folders can be dropped anywhere on the page.
  // They go where picking them would, once those that aren't audio are
  // skipped, which is said. Not while files can't be picked, nor under the
  // edit dialog.
  const takesFiles = $derived(desktop.current && addBusy === null && !batchUploading && editingBeat === null);
  // Said of the last files dropped: how many weren't audio.
  let dropNote = $state<string | null>(null);

  async function filesDrop(data: DataTransfer) {
    // Asked before the drop is over, which empties it. Reading a folder can
    // take a while, and nothing else can be added meanwhile.
    const entries = entriesDropped(data);
    let files = [...data.files];
    if (entries) {
      readingDrop = true;
      files = await filesIn(entries);
      readingDrop = false;
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

{#snippet addFromLinkButton()}
  {#if addFromLink}
    <button type="button" class="button" onclick={openLinkBox} disabled={addBusy !== null || batchUploading || linking}>
      Add from link
    </button>
  {/if}
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

<FileDrop takes={takesFiles} label="Drop audio files or folders to add them as Beats" onDrop={filesDrop} />

<header class="bar" bind:borderBoxSize={headerBox}>
  <h1>Beats</h1>
  <div class="adds">
    {@render addFromLinkButton()}
    {@render addBeatButton('Add Beat')}
  </div>
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
  {#if linking}
    <AddFromLink
      {maxUploadBytes}
      onFetched={(fromLink) => {
        linking = false;
        toAdd.take(fromLink);
      }}
      onClose={() => (linking = false)}
    />
  {/if}
  <AddBeatForm
    {toAdd}
    library={beats}
    already={{ action: 'Open it', onUse: (beat) => (editingId = beat.id) }}
    submitLabel="Add to Library"
    leaveLabel="Cancel"
    onAdded={() => {
      dropNote = null;
      reloads++;
    }}
    onLeave={() => (dropNote = null)}
    idPrefix="new-beat"
  />
  {#if dropNote}
    <p class="muted skipped" role="status">{dropNote}</p>
  {/if}
  {#if readingDrop}
    <p class="muted" role="status">Reading the files dropped…</p>
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
      <div class="adds">
        {@render addBeatButton('Add your first Beat')}
        {@render addFromLinkButton()}
      </div>
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
  .adds {
    display: flex;
    gap: var(--space-2);
  }
  /* The title and both ways to add a Beat share a phone's width; on the
     narrowest, the buttons go under the title rather than squeezing it. */
  .bar {
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .bar .adds {
    margin-left: auto;
  }
  .adds :global(.button) {
    white-space: nowrap;
  }
  .empty .adds {
    flex-wrap: wrap;
    justify-content: center;
  }
  .skipped {
    margin-bottom: var(--space-4);
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
