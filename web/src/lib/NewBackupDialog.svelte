<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Backup, type SongSummary } from './api';
  import { closeOnBackdrop } from './backdrop';
  import { backupName, backupSize } from './backups';

  // "New Backup": picks what goes in, then makes the Backup in the same
  // modal dialog, which holds focus until it's made: it can't be closed
  // meanwhile, by a click outside, Esc, or a button.
  let {
    onMade,
    onClose,
  }: {
    /** Hears the Backup made, as soon as it is. */
    onMade: (backup: Backup) => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let phase = $state<'picking' | 'making' | 'made'>('picking');
  let songs = $state<SongSummary[] | null>(null);
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let all = $state(true);
  let picked = $state<Set<number>>(new Set());
  let made = $state<Backup | null>(null);

  /** How many Songs it would hold, as picked. */
  const count = $derived(all ? (songs?.length ?? 0) : picked.size);
  const songsWord = (n: number) => `${n} ${n === 1 ? 'Song' : 'Songs'}`;

  onMount(() => dialog?.showModal());

  api.listSongs().then(
    (list) => (songs = [...list].sort((a, b) => a.title.localeCompare(b.title))),
    (e: Error) => (loadError = e.message),
  );

  function toggle(id: number) {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    picked = next;
  }

  async function make() {
    phase = 'making';
    error = null;
    try {
      made = await api.makeBackup(all ? { allSongs: true } : { songs: [...picked] });
      onMade(made);
      phase = 'made';
    } catch (e) {
      error = `Couldn't make the Backup (${(e as Error).message})`;
      phase = 'picking';
    }
  }

  function oncancel(e: Event) {
    if (phase === 'making') e.preventDefault();
  }
</script>

<dialog
  bind:this={dialog}
  {@attach closeOnBackdrop(() => phase !== 'making')}
  {oncancel}
  onclose={onClose}
  aria-labelledby="new-backup-heading"
>
  <header>
    <h2 id="new-backup-heading">New Backup</h2>
    {#if phase !== 'making'}
      <button type="button" class="icon" onclick={() => dialog?.close()} aria-label="Close">✕</button>
    {/if}
  </header>

  {#if phase === 'picking'}
    {#if loadError}
      <p class="problem" role="alert">{loadError}</p>
    {:else if songs === null}
      <p class="muted">Loading…</p>
    {:else if songs.length === 0}
      <p>There are no Songs to back up yet.</p>
    {:else}
      <fieldset>
        <legend>Songs</legend>
        <label>
          <input type="radio" name="backup-songs" checked={all} onchange={() => (all = true)} />
          <span>All Songs ({songs.length})</span>
        </label>
        <label>
          <input type="radio" name="backup-songs" checked={!all} onchange={() => (all = false)} />
          <span>Choose Songs</span>
        </label>
      </fieldset>
      {#if !all}
        <div class="choose">
          <div class="choose-actions">
            <button type="button" class="link" onclick={() => (picked = new Set(songs?.map((s) => s.id)))}>
              Select all
            </button>
            <button type="button" class="link" onclick={() => (picked = new Set())} disabled={picked.size === 0}>
              Clear
            </button>
          </div>
          <ul class="songs" aria-label="Songs to back up">
            {#each songs as song (song.id)}
              <li>
                <label>
                  <input type="checkbox" checked={picked.has(song.id)} onchange={() => toggle(song.id)} />
                  <span class="title">{song.title}</span>
                </label>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      <p class="muted">
        Each Song is backed up whole, from its Lyric Sheet to its Timeline, Cover and Masters, with the Beats its Clips
        use.
      </p>
    {/if}
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
  {:else if phase === 'making'}
    <p role="status" aria-live="polite">Backing up {songsWord(count)}…</p>
    <progress aria-label="Making the Backup"></progress>
    <p class="muted">Don't leave or close this page until it's done.</p>
  {:else if made}
    <p role="status">Backed up as “{backupName(made)}”, {backupSize(made.size)}.</p>
  {/if}

  <div class="actions">
    {#if phase === 'picking'}
      {#if songs && songs.length > 0}
        <button type="button" class="button primary" onclick={make} disabled={count === 0}>
          Back up {count > 0 ? songsWord(count) : ''}
        </button>
      {/if}
      <button type="button" class="button" onclick={() => dialog?.close()}>Cancel</button>
    {:else if phase === 'made' && made}
      <a class="button primary" href={api.backupDownloadUrl(made.id)} download>Download</a>
      <button type="button" class="button" onclick={() => dialog?.close()}>Done</button>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(28rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--bg);
    color: var(--text);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  h2 {
    margin: 0;
    font-size: 1.125rem;
  }
  p {
    margin: 0;
  }
  fieldset {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 0.375rem;
    padding: 0;
    font-weight: 600;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--control);
    cursor: pointer;
  }
  label input {
    flex: none;
    width: 1.25rem;
    height: 1.25rem;
    min-height: 0;
    margin: 0;
    padding: 0;
    accent-color: var(--accent);
  }
  .choose {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-height: 0;
  }
  .choose-actions {
    display: flex;
    gap: 1rem;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }
  .link:disabled {
    color: var(--text-muted);
    cursor: default;
  }
  /* About six Songs, then it scrolls. */
  .songs {
    max-height: calc(6.5 * var(--control));
    overflow-y: auto;
    margin: 0;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    list-style: none;
    overscroll-behavior: contain;
  }
  .songs label {
    padding-block: 0.25rem;
  }
  .title {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  progress {
    width: 100%;
    accent-color: var(--accent);
  }
  .problem {
    color: var(--danger);
  }
  .muted {
    font-size: 0.875rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
