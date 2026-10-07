<script lang="ts">
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import { onDestroy, tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import AddBeatForm from './AddBeatForm.svelte';
  import AddFromLink from './AddFromLink.svelte';
  import { api, type Beat, type Song } from './api';
  import BeatFilters from './BeatFilters.svelte';
  import BeatTable from './BeatTable.svelte';
  import { BeatToAdd, fileReader } from './beatToAdd.svelte';
  import Dialog from './Dialog.svelte';
  import { defaultBeatListView, filterBeats, isBeatListFiltered, songBeatHint, sortBeats } from './listViews';
  import { playMediaAlone, release } from './playback';
  import { formatDuration } from './time';

  // Picks a Beat to add to a Song: one from the Beat Library, found with the
  // Library's search, filters and sort, or a new upload or one from a link,
  // which joins the Library first. The Song's BPM and key show as a hint but are never
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

  // A new Beat being added, which joins the Library and is then picked.
  const toAdd = new BeatToAdd(
    fileReader(() => maxUploadBytes),
    api,
  );
  // Whether From link is offered, and whether its box is open.
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

  function pickRow(event: MouseEvent, beat: Beat) {
    // The title's button picks on its own.
    if ((event.target as Element).closest('button')) return;
    onPick(beat);
  }

  // Each Beat previews through one audio element, so only one plays at a
  // time, and it takes turns with the Timeline like any other player.
  let audio = $state<HTMLAudioElement>();
  let previewId = $state<number | null>(null);
  let previewPlaying = $state(false);
  const previewBeat = $derived(beats?.find((b) => b.id === previewId) ?? null);

  const playingNow = (beat: Beat) => previewId === beat.id && previewPlaying;

  async function togglePreview(beat: Beat) {
    if (previewId !== beat.id) {
      previewId = beat.id;
      await tick();
    } else if (!audio?.paused) {
      audio?.pause();
      return;
    }
    audio?.play().catch(() => (previewPlaying = false));
  }

  // A Beat stops once its button goes, filtered out or behind an upload or the link box.
  $effect(() => {
    if (previewId !== null && (toAdd.adding || linking || !shown?.some((b) => b.id === previewId))) audio?.pause();
  });

  // Closing the picker ends its preview.
  $effect(() => {
    const player = audio;
    return () => {
      if (!player) return;
      player.pause();
      release(player);
    };
  });

  function facts(beat: Beat): string {
    return [beat.producer, beat.bpm ? `${beat.bpm} BPM` : '', beat.key, formatDuration(beat.duration)]
      .filter(Boolean)
      .join(' · ');
  }

  async function pickFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) toAdd.read(file);
  }

  function openLinkBox() {
    toAdd.leave();
    linking = true;
  }

  // Closing the Picker discards a fetched file not added.
  onDestroy(() => toAdd.close());
</script>

{#snippet previewButton(beat: Beat)}
  <button
    type="button"
    class="icon preview"
    aria-label="{playingNow(beat) ? 'Pause' : 'Preview'} {beat.title}"
    onclick={() => togglePreview(beat)}
  >
    {#if playingNow(beat)}<Pause />{:else}<Play />{/if}
  </button>
{/snippet}

<!-- A click outside closes it while browsing, but never loses a new Beat's file and details.
     Desktop has room for the Library's table, sorted by its headers, and
     the dialog keeps its height as filters narrow the Beats down. -->
<Dialog
  bind:dialog
  title="Add a Beat"
  dismissible={() => toAdd.adding === null && !linking && toAdd.busy === null}
  stack={false}
  onclose={onClose}
  --dialog-width={desktop.current ? 'min(64rem, calc(100vw - 4rem))' : '36rem'}
  --dialog-height={desktop.current ? 'min(48rem, calc(100vh - 4rem))' : 'fit-content'}
  --dialog-max-height={desktop.current ? 'none' : 'min(40rem, calc(100vh - 2rem))'}
>
  <!-- The form adding a Beat, below, takes the dialog while it's open. -->
  {#if !toAdd.adding && linking}
    <AddFromLink
      {maxUploadBytes}
      card={false}
      onFetched={(fromLink) => {
        linking = false;
        toAdd.take(fromLink);
      }}
      onClose={() => (linking = false)}
    />
  {:else if !toAdd.adding}
    <BeatFilters bind:view beats={beats ?? []} idPrefix="beat-picker" {hint}>
      {#snippet actions()}
        {#if addFromLink}
          <button type="button" class="button add" onclick={openLinkBox} disabled={toAdd.busy !== null}
            >From link</button
          >
        {/if}
        <label class="button add" class:disabled={toAdd.busy !== null}>
          Upload new
          <input
            class="visually-hidden"
            type="file"
            accept="audio/*"
            onchange={pickFile}
            disabled={toAdd.busy !== null}
          />
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
      <BeatTable
        beats={shown}
        bind:sort={view.sort}
        lead={{ label: 'Preview', cell: previewButton }}
        onRowClick={pickRow}
      >
        {#snippet title(beat)}
          <button type="button" onclick={() => onPick(beat)}>{beat.title}</button>
        {/snippet}
      </BeatTable>
    {:else}
      <ul class="beats">
        {#each shown as beat (beat.id)}
          <li>
            {@render previewButton(beat)}
            <button type="button" class="pick" onclick={() => onPick(beat)}>
              <span class="title">{beat.title}</span>
              <span class="muted tabular">{facts(beat)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  <audio
    bind:this={audio}
    src={previewBeat ? api.beatAudioUrl(previewBeat) : undefined}
    preload="none"
    onplay={(e) => {
      playMediaAlone(e);
      previewPlaying = true;
    }}
    onpause={() => (previewPlaying = false)}
    onended={() => (previewPlaying = false)}
  ></audio>

  <!-- With what reading or adding a Beat says, under the list while there's no form. -->
  <AddBeatForm
    {toAdd}
    library={beats}
    already={{ action: 'Use it', onUse: onPick }}
    submitLabel="Add to Library and Song"
    leaveLabel="Back"
    onAdded={onPick}
    idPrefix="picker-beat"
    card={false}
  />
</Dialog>

<style>
  .add {
    flex-shrink: 0;
  }
  .beats {
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--border);
  }
  .beats li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border-bottom: 1px solid var(--border);
  }
  .preview {
    flex-shrink: 0;
    color: var(--accent);
  }
  .preview:hover:not(:disabled) {
    color: var(--accent);
  }
  .beats .pick {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: var(--control);
    padding: var(--space-2) var(--space-1);
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .beats .pick:hover {
    background: var(--surface-1);
  }
  .title {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .beats .muted {
    font-size: var(--text-sm);
  }
  .empty {
    padding: var(--space-6) 0;
    text-align: center;
  }
  .empty p {
    margin-top: 0;
  }
</style>
