<script lang="ts">
  import { untrack } from 'svelte';
  import { api, type Master, type Song, type SongAt, type Status } from './api';
  import AudioPlayer from './AudioPlayer.svelte';
  import type { Typing } from './saves.svelte';
  import { masterFields, type MasterFields } from './songFields';
  import type { Mode } from './songMode';
  import { cancelOnEscape, committedAsItGoes, leaveOnEscape } from './typedField.svelte';
  import { prepareUpload } from './upload';

  // A Song's Masters: finished recordings made elsewhere. The page is made
  // for one; names and the main marker only show once there's a second.
  let {
    song,
    mode,
    change,
    typing,
    setStatus,
    recording = false,
  }: {
    song: Song;
    /** The Song page's mode: in Read mode the Masters only play. */
    mode: Mode;
    /** Sends a change to the Song; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    /** Puts a name or notes being typed on Saves' list of edits being typed. */
    typing: (entry: Typing) => () => void;
    /** Changes the Song's Status, as its own Status control would. */
    setStatus: (status: Status) => void;
    /** Whether the Timeline is recording, which no Master plays over. */
    recording?: boolean;
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

  // Each Master's waveform, fetched once: the Song is replaced after every
  // change to it but a Master's file never changes.
  let peaks = $state<Record<number, number[]>>({});
  const fetched = new Set<number>();
  $effect(() => {
    const songId = song.id;
    for (const { id } of song.masters) {
      if (fetched.has(id)) continue;
      fetched.add(id);
      api.getMaster(songId, id).then(
        (m) => (peaks[id] = m.peaks ?? []),
        // Without peaks the waveform stays flat; the audio still plays.
        () => {},
      );
    }
  });

  const several = $derived(song.masters.length > 1);
  const writing = $derived(mode === 'write');
  // Each Master's name and notes, typed in place (see songFields.ts): a
  // blank name is refused, saying why. Made once per Master.
  const fields = new Map<number, MasterFields>();

  function fieldsOf(m: Master): MasterFields {
    let f = fields.get(m.id);
    if (!f) {
      f = masterFields(m.id, {
        master: () => song.masters.find((s) => s.id === m.id),
        change: untrack(() => change),
        typing: untrack(() => typing),
        update: api.updateMaster,
        refuse: (message) => (error = message),
      });
      fields.set(m.id, f);
    }
    return f;
  }

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
    {#if writing}
      <label class="button" class:disabled={busy !== null}>
        {song.masters.length > 0 ? 'Add another' : 'Add Master'}
        <input class="visually-hidden" type="file" accept="audio/*" onchange={pick} disabled={busy !== null} />
      </label>
    {/if}
  </div>

  {#if song.masters.length === 0 && !busy}
    <p class="hint muted">
      {writing ? "The finished recording, once it's made: a studio mix, a demo, a live recording." : 'No Master yet.'}
    </p>
  {/if}

  {#if suggestFinished && writing}
    <div class="suggest" role="status">
      <p>Is this Song finished?</p>
      <button type="button" class="button primary" onclick={markFinished}>Mark as finished</button>
      <button type="button" class="button" onclick={() => (suggestFinished = false)}>Not yet</button>
    </div>
  {/if}

  {#each song.masters as m (m.id)}
    {@const { name, notes } = fieldsOf(m)}
    <article class="master" aria-label={several ? m.name : 'Master'}>
      {#if several}
        <div class="name-row">
          {#if writing}
            <label class="visually-hidden" for="master-{m.id}-name">Name</label>
            <input
              id="master-{m.id}-name"
              class="name"
              bind:value={name.shown}
              {@attach committedAsItGoes(name)}
              onchange={() => name.commit()}
              onkeydown={cancelOnEscape(name)}
              autocomplete="off"
              enterkeyhint="done"
            />
          {:else}
            <h3 class="name">{m.name}</h3>
          {/if}
          {#if m.main}
            <span class="main-badge">Main</span>
          {:else if writing}
            <button type="button" class="button" onclick={() => change((at) => api.makeMainMaster(at, m.id))}>
              Make main
            </button>
          {/if}
        </div>
      {/if}

      <AudioPlayer
        src={api.masterAudioUrl(song.id, m.id)}
        duration={m.duration}
        peaks={peaks[m.id] ?? []}
        playOffHint={recording ? 'Stop recording to play' : null}
      />

      {#if writing}
        <label class="notes">
          Notes
          <textarea
            bind:value={notes.shown}
            {@attach committedAsItGoes(notes)}
            onchange={() => notes.commit()}
            onkeydown={leaveOnEscape(notes)}
            rows="2"></textarea>
        </label>
      {:else if m.notes.trim()}
        <p class="read-notes">{m.notes}</p>
      {/if}

      <div class="facts">
        <span class="muted">Added <time datetime={m.addedAt}>{dateFormat.format(new Date(m.addedAt))}</time></span>
        <span class="spacer"></span>
        <a class="button" href={api.masterDownloadUrl(song.id, m.id)} download={m.fileName}>Download</a>
        {#if writing}
          <button type="button" class="button danger" onclick={() => remove(m)}>Delete</button>
        {/if}
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
    margin-bottom: var(--space-8);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  h2 {
    font-size: var(--text-lg);
    margin: 0;
  }
  .hint {
    margin: 0;
    font-size: var(--text-md);
  }
  .suggest {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
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
    gap: var(--space-3);
    padding: var(--space-3) 0;
  }
  .master + .master {
    border-top: 1px solid var(--border);
  }
  .name-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }
  h3.name {
    margin: 0;
    font-size: var(--text-lg);
    overflow-wrap: anywhere;
  }
  .read-notes {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .main-badge {
    flex-shrink: 0;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--accent-text);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .notes {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
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
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
  .spacer {
    flex: 1;
  }
</style>
