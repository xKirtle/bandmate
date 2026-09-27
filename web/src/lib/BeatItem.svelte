<script lang="ts">
  import { api, type Beat } from './api';
  import BeatFields from './BeatFields.svelte';
  import { changedDetails, fromDraft, toDraft } from './beatDraft';
  import { playMediaAlone } from './playback';
  import { formatDuration } from './time';
  import { prepareUpload } from './upload';

  // One Beat in the Beat Library: its credit and a preview player, and, once
  // opened for editing, its details, file and deletion.
  let {
    beat,
    maxUploadBytes,
    onChange,
    onDelete,
  }: {
    beat: Beat;
    maxUploadBytes: number;
    onChange: (beat: Beat) => void;
    onDelete: (id: number) => void;
  } = $props();

  let editing = $state(false);
  let draft = $state(toDraft(null));
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  const inUse = $derived(beat.songs.length > 0);
  const facts = $derived(
    [beat.bpm ? `${beat.bpm} BPM` : '', beat.key, formatDuration(beat.duration)].filter(Boolean).join(' · '),
  );

  function edit() {
    draft = toDraft(beat);
    error = null;
    editing = true;
  }

  async function run(label: string, work: () => Promise<void>) {
    busy = label;
    error = null;
    try {
      await work();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = null;
    }
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    const details = fromDraft(draft);
    if (typeof details === 'string') {
      error = details;
      return;
    }
    const changes = changedDetails(beat, details);
    if (Object.keys(changes).length === 0) {
      editing = false;
      return;
    }
    run('Saving…', async () => {
      onChange(await api.updateBeat(beat.id, changes));
      editing = false;
    });
  }

  function replaceFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    run('Reading file…', async () => {
      const decoded = await prepareUpload(file, maxUploadBytes);
      busy = 'Uploading…';
      onChange(await api.replaceBeatFile(beat.id, file, decoded));
    });
  }

  function remove() {
    if (!confirm(`Delete “${beat.title}” and its file?\n\nThis can't be undone.`)) return;
    run('Deleting…', async () => {
      await api.deleteBeat(beat.id);
      onDelete(beat.id);
    });
  }
</script>

<article class="beat" aria-labelledby="beat-{beat.id}-title">
  <div class="head">
    <div class="credit">
      <h2 id="beat-{beat.id}-title">{beat.title}</h2>
      <p class="muted">
        {#if beat.producer && beat.sourceLink}
          <a href={beat.sourceLink} target="_blank" rel="noopener noreferrer">{beat.producer}</a>
        {:else if beat.sourceLink}
          <a href={beat.sourceLink} target="_blank" rel="noopener noreferrer">Source</a>
        {:else if beat.producer}
          {beat.producer}
        {:else}
          No producer credited
        {/if}
        · {facts}
      </p>
    </div>
    {#if !editing}
      <button type="button" class="button" onclick={edit}>Edit</button>
    {/if}
  </div>

  <audio controls preload="none" src={api.beatAudioUrl(beat)} onplay={playMediaAlone}></audio>

  {#if inUse}
    <p class="songs muted">Used in {beat.songs.map((s) => s.title).join(', ')}</p>
  {/if}

  {#if editing}
    <form onsubmit={save}>
      <BeatFields bind:draft idPrefix="beat-{beat.id}" />
      <div class="actions">
        <button type="submit" class="button primary" disabled={busy !== null}>Save</button>
        <button type="button" class="button" onclick={() => (editing = false)} disabled={busy !== null}>Cancel</button>
        <span class="spacer"></span>
        {#if inUse}
          <p class="muted hint">Used by a Song, so its file can't be replaced or the Beat deleted.</p>
        {:else}
          <label class="button">
            Replace file
            <input
              class="visually-hidden"
              type="file"
              accept="audio/*"
              onchange={replaceFile}
              disabled={busy !== null}
            />
          </label>
          <button type="button" class="button danger" onclick={remove} disabled={busy !== null}>Delete</button>
        {/if}
      </div>
    </form>
  {:else if beat.notes}
    <p class="notes">{beat.notes}</p>
  {/if}

  {#if busy}
    <p class="muted" role="status">{busy}</p>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</article>

<style>
  .beat {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 0.25rem;
    border-bottom: 1px solid var(--border);
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .credit {
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 1.0625rem;
    overflow-wrap: anywhere;
  }
  .credit p,
  .songs,
  .notes {
    margin: 0;
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }
  .notes {
    white-space: pre-wrap;
  }
  audio {
    width: 100%;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .spacer {
    flex: 1;
  }
  .hint {
    margin: 0;
    font-size: 0.8125rem;
  }
  label.button:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
