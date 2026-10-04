<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Backup, type BackupSong } from './api';
  import { closeOnBackdrop } from './backdrop';
  import { backupName, songCount } from './backups';

  // "Restore": picks Songs from a Backup, some or all, then restores them,
  // each with the Beats its Clips use, in the same modal dialog, which holds
  // focus until they're back: it can't be closed meanwhile, by a click
  // outside, Esc, or a button. A Song or Beat already in Bandmate is kept
  // both, the restored one added alongside as "Title (restored)".
  let {
    backup,
    onClose,
  }: {
    backup: Backup;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let phase = $state<'picking' | 'restoring' | 'restored'>('picking');
  let songs = $state<BackupSong[] | null>(null);
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let picked = $state<Set<number>>(new Set());
  let restored = $state<BackupSong[]>([]);

  onMount(() => dialog?.showModal());

  // svelte-ignore state_referenced_locally
  api.backupSongs(backup.id).then(
    (list) => {
      songs = list;
      // One Song is the one to restore.
      if (list.length === 1) picked = new Set([list[0].id]);
    },
    (e: Error) => (loadError = e.message),
  );

  function toggle(id: number) {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    picked = next;
  }

  async function restore() {
    phase = 'restoring';
    error = null;
    try {
      restored = (await api.restoreBackup(backup.id, [...picked])).songs;
      phase = 'restored';
    } catch (e) {
      error = `Couldn't restore (${(e as Error).message})`;
      phase = 'picking';
    }
  }

  function oncancel(e: Event) {
    if (phase === 'restoring') e.preventDefault();
  }
</script>

<dialog
  bind:this={dialog}
  {@attach closeOnBackdrop(() => phase !== 'restoring')}
  {oncancel}
  onclose={onClose}
  aria-labelledby="restore-backup-heading"
>
  <header>
    <h2 id="restore-backup-heading">Restore</h2>
    {#if phase !== 'restoring'}
      <button type="button" class="icon" onclick={() => dialog?.close()} aria-label="Close">✕</button>
    {/if}
  </header>

  {#if phase === 'picking'}
    <p class="muted">From “{backupName(backup)}”</p>
    {#if loadError}
      <p class="problem" role="alert">{loadError}</p>
    {:else if songs === null}
      <p class="muted">Loading…</p>
    {:else if songs.length === 0}
      <p>This Backup holds no Songs.</p>
    {:else}
      <div class="choose">
        <div class="choose-actions">
          <button type="button" class="link" onclick={() => (picked = new Set(songs?.map((s) => s.id)))}>
            Choose all
          </button>
          <button type="button" class="link" onclick={() => (picked = new Set())} disabled={picked.size === 0}>
            Clear
          </button>
        </div>
        <ul class="songs" aria-label="Songs to restore">
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
      <p class="muted">
        Each Song comes back whole, with the Beats its Clips use. A Song or Beat already in Bandmate is kept, and the
        restored one added alongside, titled “(restored)”.
      </p>
    {/if}
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
  {:else if phase === 'restoring'}
    <p role="status" aria-live="polite">Restoring {songCount(picked.size)}…</p>
    <progress aria-label="Restoring"></progress>
    <p class="muted">Don't leave or close this page until it's done.</p>
  {:else}
    <p role="status">Restored {songCount(restored.length)}.</p>
    <ul class="restored">
      {#each restored as song (song.id)}
        <li><a href="/songs/{song.id}" onclick={() => dialog?.close()}>{song.title}</a></li>
      {/each}
    </ul>
  {/if}

  <div class="actions">
    {#if phase === 'picking'}
      {#if songs && songs.length > 0}
        <button type="button" class="button primary" onclick={restore} disabled={picked.size === 0}>
          Restore {picked.size > 0 ? songCount(picked.size) : ''}
        </button>
      {/if}
      <button type="button" class="button" onclick={() => dialog?.close()}>Cancel</button>
    {:else if phase === 'restored'}
      <button type="button" class="button primary" onclick={() => dialog?.close()}>Done</button>
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
  .restored {
    max-height: calc(6.5 * var(--control));
    overflow-y: auto;
    margin: 0;
    padding-left: 1.25rem;
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
