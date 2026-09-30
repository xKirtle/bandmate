<script lang="ts">
  import { tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { api, type Beat, type DecodedAudio } from '../lib/api';
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

  const desktop = new MediaQuery('min-width: 80rem');

  // On desktop, the table previews Beats through the bar at the bottom, which
  // keeps the last Beat previewed until the Beat is deleted, the window narrows
  // or the page is left.
  let previewId = $state<number | null>(null);
  const previewBeat = $derived((desktop.current && beats?.find((b) => b.id === previewId)) || null);
  let previewPlaying = $state(false);
  let playerBar = $state<BeatPlayerBar>();
  let playerBarHeight = $state(0);
  // The header's size, unrounded, so the page with the bar fits the window exactly.
  let headerBox = $state<ResizeObserverSize[]>();
  const headerHeight = $derived(headerBox?.[0].blockSize ?? 0);

  async function togglePreview(beat: Beat) {
    if (previewId === beat.id && playerBar) {
      playerBar.toggle();
      return;
    }
    // A new Beat starts playing once the bar has loaded it.
    previewId = beat.id;
    await tick();
    playerBar?.play();
  }

  // The bar is desktop's: narrowing the window stops the preview for good,
  // rather than bringing it back when the window widens again.
  $effect(() => {
    if (!desktop.current) closePreview();
  });

  const playingNow = (beat: Beat) => previewId === beat.id && previewPlaying;

  function closePreview() {
    previewId = null;
    previewPlaying = false;
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

  // The Beat being edited in the dialog the table opens. The cards below
  // 80rem open their own; this one stays open across a resize, keeping its
  // unsaved changes.
  let editingId = $state<number | null>(null);
  const editingBeat = $derived(beats?.find((b) => b.id === editingId) ?? null);

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
    if (previewId === id) closePreview();
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
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  </button>
{/snippet}

{#snippet previewCell(beat: Beat)}
  <button
    type="button"
    class="icon"
    aria-label="{playingNow(beat) ? 'Pause' : 'Preview'} {beat.title}"
    onclick={() => togglePreview(beat)}
  >
    {playingNow(beat) ? '❚❚' : '▶'}
  </button>
{/snippet}

<header class="bar" bind:borderBoxSize={headerBox}>
  <h1>Beats</h1>
  <label class="button primary" class:disabled={addBusy !== null}>
    Add Beat
    <input class="visually-hidden" type="file" accept="audio/*" onchange={pick} disabled={addBusy !== null} />
  </label>
</header>

<main
  class="page"
  class:with-player={previewBeat}
  style:--header-height="{headerHeight}px"
  style:--player-height="{playerBarHeight}px"
>
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

  <BeatFilters bind:view beats={beats ?? []} idPrefix="beat" />

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

{#if previewBeat}
  <BeatPlayerBar bind:this={playerBar} bind:playing={previewPlaying} bind:height={playerBarHeight} beat={previewBeat} />
{/if}

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
  /* With the player docked below, the page reaches at least to it, so the bar
     sits at the bottom of the window even under a short list. */
  .page.with-player {
    min-height: calc(100dvh - var(--header-height) - var(--player-height));
  }
  .edit svg {
    width: 1.125rem;
    height: 1.125rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .beats {
    border-top: 1px solid var(--border);
  }
  .empty {
    text-align: center;
    padding: 3rem 0;
  }
</style>
