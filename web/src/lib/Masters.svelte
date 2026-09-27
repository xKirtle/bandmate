<script lang="ts">
  import { api, type Master, type Song, type SongAt, type Status } from './api';
  import MasterPlayer from './MasterPlayer.svelte';
  import { prepareUpload } from './upload';

  // A Song's Masters: finished recordings made elsewhere. The page is made
  // for one; names and the main marker only show once there's a second.
  let {
    song,
    change,
    onUnsaved,
    setStatus,
  }: {
    song: Song;
    /** Sends a change to the Song; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    onUnsaved: (editor: object, unsaved: boolean) => void;
    /** Changes the Song's Status, as its own Status control would. */
    setStatus: (status: Status) => void;
  } = $props();

  let maxUploadBytes = $state(Infinity);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  // Adding a Master suggests the Song is finished, but only the user says so.
  let suggestFinished = $state(false);

  api.getConfig().then(
    (c) => (maxUploadBytes = c.maxUploadBytes),
    // The server still enforces its limit.
    () => {},
  );

  const several = $derived(song.masters.length > 1);
  // Identifies the name or notes being typed to onUnsaved.
  const naming = {};
  const noting = {};

  async function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = null;
    busy = `Reading “${file.name}”…`;
    try {
      const decoded = await prepareUpload(file, maxUploadBytes);
      busy = 'Uploading…';
      if (await change((at) => api.addMaster(at, file, decoded))) {
        suggestFinished = song.status !== 'finished';
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = null;
    }
  }

  function markFinished() {
    suggestFinished = false;
    setStatus('finished');
  }

  async function rename(m: Master, input: HTMLInputElement) {
    onUnsaved(naming, false);
    const next = input.value.trim();
    if (next === m.name) {
      input.value = m.name;
      return;
    }
    if (next === '') {
      error = 'A Master needs a name once there are several.';
      input.value = m.name;
      return;
    }
    if (!(await change((at) => api.updateMaster(at, m.id, { name: next })))) input.value = m.name;
  }

  async function saveNotes(m: Master, input: HTMLTextAreaElement) {
    onUnsaved(noting, false);
    if (input.value === m.notes) return;
    if (!(await change((at) => api.updateMaster(at, m.id, { notes: input.value })))) input.value = m.notes;
  }

  function remove(m: Master) {
    const what = several ? `the Master “${m.name}”` : 'this Master';
    if (!confirm(`Delete ${what} and its file?\n\nThis can't be undone.`)) return;
    change((at) => api.deleteMaster(at, m.id));
  }

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
</script>

<section class="masters" aria-labelledby="masters-heading">
  <div class="head">
    <h2 id="masters-heading">{several ? 'Masters' : 'Master'}</h2>
    <label class="button" class:disabled={busy !== null}>
      {song.masters.length > 0 ? 'Add another' : 'Add Master'}
      <input class="visually-hidden" type="file" accept="audio/*" onchange={pick} disabled={busy !== null} />
    </label>
  </div>

  {#if song.masters.length === 0 && !busy}
    <p class="hint muted">The finished recording, once it's made: a studio mix, a demo, a live take.</p>
  {/if}

  {#if suggestFinished}
    <div class="suggest" role="status">
      <p>Is this Song finished?</p>
      <button type="button" class="button primary" onclick={markFinished}>Mark as finished</button>
      <button type="button" class="button" onclick={() => (suggestFinished = false)}>Not yet</button>
    </div>
  {/if}

  {#each song.masters as m (m.id)}
    <article class="master" aria-label={several ? m.name : 'Master'}>
      {#if several}
        <div class="name-row">
          <label class="visually-hidden" for="master-{m.id}-name">Name</label>
          <input
            id="master-{m.id}-name"
            class="name"
            value={m.name}
            oninput={() => onUnsaved(naming, true)}
            onchange={(e) => rename(m, e.currentTarget)}
            onblur={() => onUnsaved(naming, false)}
            autocomplete="off"
            enterkeyhint="done"
          />
          {#if m.main}
            <span class="main-badge">Main</span>
          {:else}
            <button type="button" class="button" onclick={() => change((at) => api.makeMainMaster(at, m.id))}>
              Make main
            </button>
          {/if}
        </div>
      {/if}

      <MasterPlayer songId={song.id} master={m} />

      <label class="notes">
        Notes
        <textarea
          value={m.notes}
          oninput={() => onUnsaved(noting, true)}
          onchange={(e) => saveNotes(m, e.currentTarget)}
          onblur={() => onUnsaved(noting, false)}
          rows="2"
        ></textarea>
      </label>

      <div class="facts">
        <span class="muted">Added <time datetime={m.addedAt}>{dateFormat.format(new Date(m.addedAt))}</time></span>
        <span class="spacer"></span>
        <a class="button" href={api.masterDownloadUrl(song.id, m.id)} download={m.fileName}>Download</a>
        <button type="button" class="button danger" onclick={() => remove(m)}>Delete</button>
      </div>
    </article>
  {/each}

  {#if busy}
    <p class="muted" role="status">{busy}</p>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</section>

<style>
  .masters {
    margin-bottom: 2rem;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
  }
  .hint {
    margin: 0;
    font-size: 0.875rem;
  }
  .suggest {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: var(--finished-bg);
    color: var(--finished-fg);
  }
  .suggest p {
    flex: 1 1 10rem;
    margin: 0;
    font-weight: 600;
  }
  .master {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem 0;
  }
  .master + .master {
    border-top: 1px solid var(--border);
  }
  .name-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }
  .main-badge {
    flex-shrink: 0;
    padding: 0.125rem 0.625rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .notes {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .notes textarea {
    color: var(--text);
    font-weight: 400;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
  }
  .spacer {
    flex: 1;
  }
  label.button:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
