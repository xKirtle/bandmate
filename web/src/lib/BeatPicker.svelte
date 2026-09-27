<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Beat, type DecodedAudio } from './api';
  import BeatFields from './BeatFields.svelte';
  import { fromDraft, toDraft, type BeatDraft } from './beatDraft';
  import { formatDuration } from './time';
  import { baseName, prepareUpload } from './upload';

  // Picks a Beat to add to a Song: one from the Beat Library, found by
  // searching, or a new upload, which joins the Library first.
  let { onPick, onClose }: { onPick: (beat: Beat) => void; onClose: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  let q = $state('');
  let beats = $state<Beat[] | null>(null);
  let loadError = $state<string | null>(null);
  let maxUploadBytes = $state(Infinity);

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

  // Not reactive: the first load shouldn't wait, later ones debounce typing.
  let loaded = false;

  // Searches again after a pause in typing; only the latest answer shows.
  $effect(() => {
    const query = q;
    let current = true;
    const timer = setTimeout(
      () => {
        api.listBeats(query).then(
          (list) => {
            if (!current) return;
            beats = list;
            loadError = null;
            loaded = true;
          },
          (e: Error) => current && (loadError = e.message),
        );
      },
      loaded ? 200 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
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
      const decoded = await prepareUpload(file, maxUploadBytes);
      adding = { file, decoded, draft: toDraft(null, baseName(file.name)) };
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
    <div class="search">
      <label class="visually-hidden" for="beat-picker-search">Search Beats by title or producer</label>
      <input
        id="beat-picker-search"
        type="search"
        bind:value={q}
        placeholder="Search titles and producers"
        autocomplete="off"
        enterkeyhint="search"
      />
      <label class="button" class:disabled={busy !== null}>
        Upload new
        <input class="visually-hidden" type="file" accept="audio/*" onchange={pickFile} disabled={busy !== null} />
      </label>
    </div>

    {#if loadError}
      <p class="error" role="alert">{loadError}</p>
    {:else if beats === null}
      <p class="muted">Loading…</p>
    {:else if beats.length === 0}
      <p class="muted empty">
        {q.trim() ? 'No Beats match.' : 'The Beat Library is empty. Upload a beat to start.'}
      </p>
    {:else}
      <ul class="beats">
        {#each beats as beat (beat.id)}
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
  .search {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .search label.button {
    flex-shrink: 0;
  }
  .search label.disabled {
    opacity: 0.6;
    cursor: default;
  }
  .search label:has(input:focus-visible) {
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
    min-height: 2.75rem;
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
</style>
