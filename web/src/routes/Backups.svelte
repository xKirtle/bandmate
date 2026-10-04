<script lang="ts">
  // The Backups kept in Bandmate, newest first, each named from when it was
  // made and what it holds, or with a name of its own, with its size, and
  // downloadable as one file. A downloaded one, from here or another
  // install, can be uploaded to join them. Songs can be restored from each
  // that holds some. Each can be renamed, or deleted after
  // confirming; nothing deletes one otherwise.
  import ActionsMenu from '../lib/ActionsMenu.svelte';
  import { api, type Backup } from '../lib/api';
  import { automaticName, backupName, backupSize } from '../lib/backups';
  import type { MenuAction } from '../lib/menu';
  import NewBackupDialog from '../lib/NewBackupDialog.svelte';
  import RenameBackupDialog from '../lib/RenameBackupDialog.svelte';
  import RestoreBackupDialog from '../lib/RestoreBackupDialog.svelte';

  let backups = $state<Backup[] | null>(null);
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let making = $state(false);
  let renaming = $state<Backup | null>(null);
  let restoring = $state<Backup | null>(null);
  /** The name of the file being uploaded, while it is. */
  let uploading = $state<string | null>(null);
  /** What the last upload added, to say so, since it's listed by when it was made, maybe far down. */
  let uploaded = $state<string | null>(null);

  api.listBackups().then(
    (list) => (backups = list),
    (e: Error) => (loadError = e.message),
  );

  const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

  function showMade(backup: Backup) {
    backups = [backup, ...(backups ?? []).filter((b) => b.id !== backup.id)];
  }

  /** Lists an uploaded Backup where it belongs, newest first, as the server lists them. */
  function showUploaded(backup: Backup) {
    const rest = (backups ?? []).filter((b) => b.id !== backup.id);
    const made = Date.parse(backup.createdAt);
    const at = rest.findIndex((b) => {
      const other = Date.parse(b.createdAt);
      return other < made || (other === made && b.id < backup.id);
    });
    backups = at < 0 ? [...rest, backup] : [...rest.slice(0, at), backup, ...rest.slice(at)];
  }

  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = null;
    uploaded = null;
    uploading = file.name;
    try {
      const backup = await api.uploadBackup(file);
      showUploaded(backup);
      uploaded = `Added “${backupName(backup)}” from “${file.name}”.`;
    } catch (e) {
      error = `Couldn't upload “${file.name}” (${(e as Error).message})`;
    } finally {
      uploading = null;
    }
  }

  function showRenamed(backup: Backup) {
    error = null;
    backups = (backups ?? []).map((b) => (b.id === backup.id ? backup : b));
  }

  async function remove(backup: Backup) {
    const ok = confirm(
      `Delete “${backupName(backup)}”?\n\nIts file is deleted, freeing ${backupSize(backup.size)}. This can't be undone.`,
    );
    if (!ok) return;
    error = null;
    try {
      await api.deleteBackup(backup.id);
      backups = (backups ?? []).filter((b) => b.id !== backup.id);
    } catch (e) {
      error = `Couldn't delete “${backupName(backup)}” (${(e as Error).message})`;
    }
  }

  function actions(backup: Backup): MenuAction[] {
    return [
      { icon: '✎', label: 'Rename…', run: () => (renaming = backup) },
      { icon: '🗑', label: 'Delete…', run: () => remove(backup) },
    ];
  }
</script>

<header class="bar">
  <h1>Backups</h1>
  <div class="bar-actions">
    <label class="button" class:disabled={uploading !== null}>
      Upload
      <input class="visually-hidden" type="file" onchange={upload} disabled={uploading !== null} />
    </label>
    <button type="button" class="button primary" onclick={() => (making = true)}>New Backup</button>
  </div>
</header>

<main class="page">
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  {#if uploading}
    <p class="muted" role="status">Uploading “{uploading}”…</p>
  {:else if uploaded}
    <p class="muted" role="status">{uploaded}</p>
  {/if}
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if backups === null}
    <p class="muted">Loading…</p>
  {:else if backups.length === 0}
    <div class="empty">
      <p>No Backups yet.</p>
      <p class="muted">
        A Backup is a copy of chosen Songs and Beats, kept here to restore from, and downloadable as one file to keep
        elsewhere. Upload one downloaded before, here or on another install, to restore from it.
      </p>
    </div>
  {:else}
    <ul class="backups">
      {#each backups as backup (backup.id)}
        <li>
          <div class="about">
            <span class="name">{backupName(backup)}</span>
            <span class="muted details">
              {#if backup.name}{automaticName(backup)} ·{/if}
              Made at {timeFormat.format(new Date(backup.createdAt))} · {backupSize(backup.size)}
            </span>
          </div>
          <div class="row-actions">
            {#if backup.songs > 0 || backup.beats > 0}
              <button
                type="button"
                class="button"
                onclick={() => (restoring = backup)}
                aria-label="Restore from {backupName(backup)}">Restore</button
              >
            {/if}
            <a
              class="button"
              href={api.backupDownloadUrl(backup.id)}
              download
              aria-label="Download {backupName(backup)}">Download</a
            >
            <ActionsMenu label="More actions for {backupName(backup)}" entries={actions(backup)} />
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</main>

{#if making}
  <NewBackupDialog onMade={showMade} onClose={() => (making = false)} />
{/if}

{#if restoring}
  <RestoreBackupDialog backup={restoring} onClose={() => (restoring = null)} />
{/if}

{#if renaming}
  <RenameBackupDialog backup={renaming} onRenamed={showRenamed} onClose={() => (renaming = null)} />
{/if}

<style>
  .bar-actions {
    display: flex;
    gap: 0.5rem;
  }
  .bar label.disabled {
    opacity: 0.6;
    cursor: default;
  }
  .bar label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .backups {
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--border);
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    /* Where the name would be squeezed, as at phone width, the buttons go under it. */
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--border);
  }
  .about {
    display: flex;
    flex: 1 1 12rem;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .details {
    font-size: 0.875rem;
  }
  .row-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
  }
  .empty {
    text-align: center;
    padding: 3rem 0;
  }
  .empty p {
    margin: 0 0 0.5rem;
  }
</style>
