<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { api, type Beat, type DecodedAudio, type Song } from './api';
  import { closeOnBackdrop } from './backdrop';
  import BeatFields from './BeatFields.svelte';
  import BeatFilters from './BeatFilters.svelte';
  import BeatTable from './BeatTable.svelte';
  import { fromDraft, toDraft, type BeatDraft } from './beatDraft';
  import { defaultBeatListView, filterBeats, isBeatListFiltered, songBeatHint, sortBeats } from './listViews';
  import { playMediaAlone, release } from './playback';
  import { formatDuration } from './time';
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

  // A Beat stops once its button goes, filtered out or behind an upload.
  $effect(() => {
    if (previewId !== null && (adding || !shown?.some((b) => b.id === previewId))) audio?.pause();
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

{#snippet previewButton(beat: Beat)}
  <button
    type="button"
    class="icon preview"
    aria-label="{playingNow(beat) ? 'Pause' : 'Preview'} {beat.title}"
    onclick={() => togglePreview(beat)}
  >
    {playingNow(beat) ? '❚❚' : '▶'}
  </button>
{/snippet}

<!-- A click outside closes it while browsing, but never loses a new Beat's file and details. -->
<dialog
  bind:this={dialog}
  {@attach closeOnBackdrop(() => adding === null && busy === null)}
  onclose={onClose}
  aria-labelledby="beat-picker-heading"
>
  <header>
    <h2 id="beat-picker-heading">Add a Beat</h2>
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
              <span class="muted">{facts(beat)}</span>
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
    background: var(--scrim);
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
    display: flex;
    align-items: center;
    gap: 0.25rem;
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
    padding: 0.5rem 0.25rem;
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
</style>
