<script lang="ts">
  import { api, statuses, type Song, type SongChanges } from '../lib/api';
  import { navigate } from '../lib/router.svelte';
  import { timeAgo } from '../lib/time';

  let { id }: { id: number } = $props();

  // What the inputs show. Numbers stay text while typing.
  interface Draft {
    title: string;
    key: string;
    bpm: string;
    capo: string;
    tuning: string;
    notes: string;
  }

  let song = $state<Song | null>(null);
  let draft = $state<Draft>(toDraft(null));
  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  let pending = $state(0);
  let deleting = $state(false);

  const commonKeys = ['C', 'Cm', 'D', 'Dm', 'E', 'Em', 'F', 'F#m', 'G', 'Gm', 'A', 'Am', 'Bb', 'B', 'Bm'];
  const commonTunings = ['Standard', 'Drop D', 'Half step down', 'DADGAD', 'Open G', 'Open D'];

  $effect(() => {
    api.getSong(id).then(
      (s) => {
        song = s;
        draft = toDraft(s);
      },
      (e: Error) => (loadError = e.message),
    );
  });

  function toDraft(s: Song | null): Draft {
    return {
      title: s?.title ?? '',
      key: s?.key ?? '',
      bpm: s?.bpm?.toString() ?? '',
      capo: s?.capo?.toString() ?? '',
      tuning: s?.tuning ?? '',
      notes: s?.notes ?? '',
    };
  }

  // Saves run one after another so they land in the order they were made.
  let queue = Promise.resolve();

  function save(changes: SongChanges, fields: (keyof Draft)[]) {
    pending++;
    queue = queue.then(async () => {
      try {
        song = await api.updateSong(id, changes);
        saveError = null;
      } catch (e) {
        saveError = (e as Error).message;
        // Put back what the server has for the fields that failed, and
        // re-render so a rejected Status choice unchecks too.
        if (song) song = { ...song };
        const saved = toDraft(song);
        for (const f of fields) draft[f] = saved[f];
      } finally {
        pending--;
      }
    });
  }

  function commitText(field: 'title' | 'key' | 'tuning' | 'notes') {
    if (!song) return;
    const value = field === 'notes' ? draft.notes : draft[field].trim();
    if (value === song[field]) {
      draft[field] = song[field];
      return;
    }
    save({ [field]: value }, [field]);
  }

  function commitNumber(field: 'bpm' | 'capo', label: string) {
    if (!song) return;
    const text = draft[field].trim();
    if (text !== '' && !/^\d+$/.test(text)) {
      saveError = `${label} must be a whole number`;
      draft[field] = toDraft(song)[field];
      return;
    }
    const value = text === '' ? null : Number(text);
    if (value === song[field]) return;
    save({ [field]: value }, [field]);
  }

  async function remove() {
    if (!song) return;
    const ok = confirm(`Delete “${song.title}”?\n\nThis removes the Song and everything in it. It can't be undone.`);
    if (!ok) return;
    deleting = true;
    try {
      await api.deleteSong(id);
      navigate('/', { replace: true });
    } catch (e) {
      saveError = (e as Error).message;
      deleting = false;
    }
  }
</script>

<header class="bar">
  <a class="back" href="/">← Songs</a>
  {#if song}
    <button type="button" class="button danger" onclick={remove} disabled={deleting}>
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  {/if}
</header>

<main class="page">
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if song === null}
    <p class="muted">Loading…</p>
  {:else}
    <label class="visually-hidden" for="song-title">Title</label>
    <input
      id="song-title"
      class="title"
      bind:value={draft.title}
      onchange={() => commitText('title')}
      required
      autocomplete="off"
      enterkeyhint="done"
    />

    <p class="save-state muted" role="status">
      {#if pending > 0}
        Saving…
      {:else}
        Edited <time datetime={song.updatedAt}>{timeAgo(song.updatedAt)}</time>
      {/if}
    </p>
    {#if saveError}
      <p class="error" role="alert">{saveError}</p>
    {/if}

    <fieldset class="status">
      <legend class="visually-hidden">Status</legend>
      {#each statuses as s (s)}
        <label class="segment segment-{s}">
          <input
            type="radio"
            name="status"
            value={s}
            checked={song.status === s}
            onchange={() => save({ status: s }, [])}
          />
          {s}
        </label>
      {/each}
    </fieldset>

    <section class="details" aria-labelledby="details-heading">
      <h2 id="details-heading">Details</h2>
      <div class="grid">
        <label>
          Key
          <input
            bind:value={draft.key}
            onchange={() => commitText('key')}
            list="common-keys"
            autocomplete="off"
            autocapitalize="characters"
            enterkeyhint="done"
            placeholder="—"
          />
        </label>
        <label>
          BPM
          <input
            bind:value={draft.bpm}
            onchange={() => commitNumber('bpm', 'BPM')}
            inputmode="numeric"
            autocomplete="off"
            enterkeyhint="done"
            placeholder="—"
          />
        </label>
        <label>
          Capo
          <input
            bind:value={draft.capo}
            onchange={() => commitNumber('capo', 'Capo')}
            inputmode="numeric"
            autocomplete="off"
            enterkeyhint="done"
            placeholder="—"
          />
        </label>
        <label>
          Tuning
          <input
            bind:value={draft.tuning}
            onchange={() => commitText('tuning')}
            list="common-tunings"
            autocomplete="off"
            enterkeyhint="done"
            placeholder="—"
          />
        </label>
      </div>
      <label>
        Notes
        <textarea bind:value={draft.notes} onchange={() => commitText('notes')} rows="5"></textarea>
      </label>
    </section>

    <datalist id="common-keys">
      {#each commonKeys as k (k)}<option value={k}></option>{/each}
    </datalist>
    <datalist id="common-tunings">
      {#each commonTunings as t (t)}<option value={t}></option>{/each}
    </datalist>
  {/if}
</main>

<style>
  .title {
    min-height: 3rem;
    margin: 0 0 0.25rem;
    padding: 0.25rem 0.5rem;
    margin-left: -0.5rem;
    width: calc(100% + 0.5rem);
    border-color: transparent;
    background: transparent;
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.2;
  }
  .title:hover,
  .title:focus {
    border-color: var(--border);
    background: var(--surface-1);
  }
  .save-state {
    margin: 0 0 1rem;
    font-size: 0.8125rem;
  }
  .error {
    margin-bottom: 1rem;
  }
  .status {
    display: flex;
    margin: 0 0 1.5rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .segment {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 2.75rem;
    background: var(--surface-1);
    font-weight: 600;
    text-transform: capitalize;
    cursor: pointer;
  }
  .segment + .segment {
    border-left: 1px solid var(--border);
  }
  .segment input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    min-height: 0;
  }
  .segment:has(input:checked) {
    background: var(--surface-2);
  }
  .segment-drafting:has(input:checked) {
    background: var(--drafting-bg);
    color: var(--drafting-fg);
  }
  .segment-finished:has(input:checked) {
    background: var(--finished-bg);
    color: var(--finished-fg);
  }
  .segment:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .details h2 {
    font-size: 1rem;
    margin: 0 0 0.75rem;
  }
  .details label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .details input,
  .details textarea {
    color: var(--text);
    font-weight: 400;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  @media (min-width: 36rem) {
    .grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
</style>
