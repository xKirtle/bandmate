<script lang="ts">
  import { api, type Beat, type DecodedAudio } from '../lib/api';
  import BeatFields from '../lib/BeatFields.svelte';
  import BeatItem from '../lib/BeatItem.svelte';
  import { fromDraft, toDraft, type BeatDraft } from '../lib/beatDraft';
  import MainNav from '../lib/MainNav.svelte';
  import { formatDuration } from '../lib/time';
  import { baseName, prepareUpload } from '../lib/upload';

  let beats = $state<Beat[] | null>(null);
  let loadError = $state<string | null>(null);
  let q = $state('');
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

  // Not reactive: the first load shouldn't wait, later ones debounce typing.
  let loaded = false;

  // Reloads whenever the search changes, waiting for a pause in typing. Only
  // the latest request's answer is shown.
  $effect(() => {
    const query = q;
    void reloads;
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

  async function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    adding = null;
    addError = null;
    addBusy = `Reading “${file.name}”…`;
    try {
      const decoded = await prepareUpload(file, maxUploadBytes);
      adding = { file, decoded, draft: toDraft(null, baseName(file.name)) };
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

  function showChanged(beat: Beat) {
    beats = beats?.map((b) => (b.id === beat.id ? beat : b)) ?? null;
  }

  function dropDeleted(id: number) {
    beats = beats?.filter((b) => b.id !== id) ?? null;
  }
</script>

<header class="bar">
  <MainNav current="beats" />
  <label class="button primary" class:disabled={addBusy !== null}>
    Add Beat
    <input class="visually-hidden" type="file" accept="audio/*" onchange={pick} disabled={addBusy !== null} />
  </label>
</header>

<main class="page">
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

  <search class="filters">
    <label class="visually-hidden" for="beat-search">Search Beats by title or producer</label>
    <input
      id="beat-search"
      type="search"
      bind:value={q}
      placeholder="Search titles and producers"
      autocomplete="off"
      enterkeyhint="search"
    />
  </search>

  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if beats === null}
    <p class="muted">Loading…</p>
  {:else if beats.length === 0 && q.trim() !== ''}
    <div class="empty">
      <p>No Beats match.</p>
      <button type="button" class="button" onclick={() => (q = '')}>Clear search</button>
    </div>
  {:else if beats.length === 0}
    <div class="empty">
      <p>No Beats yet. Add an audio file to use it in any Song.</p>
    </div>
  {:else}
    <div class="beats">
      {#each beats as beat (beat.id)}
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
    display: block;
    margin-bottom: 0.5rem;
  }
  .beats {
    border-top: 1px solid var(--border);
  }
  .empty {
    text-align: center;
    padding: 3rem 0;
  }
</style>
