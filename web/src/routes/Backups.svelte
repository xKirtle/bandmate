<script lang="ts">
  // The Backups kept in Bandmate, newest first, each named from when it was
  // made and what it holds, or with a name of its own, with its size, and
  // downloadable as one file. Each can be renamed, or deleted after
  // confirming; nothing deletes one otherwise.
  import ActionsMenu from '../lib/ActionsMenu.svelte';
  import { api, type Backup } from '../lib/api';
  import { automaticName, backupName, backupSize } from '../lib/backups';
  import type { MenuAction } from '../lib/menu';
  import NewBackupDialog from '../lib/NewBackupDialog.svelte';
  import RenameBackupDialog from '../lib/RenameBackupDialog.svelte';

  let backups = $state<Backup[] | null>(null);
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let making = $state(false);
  let renaming = $state<Backup | null>(null);

  api.listBackups().then(
    (list) => (backups = list),
    (e: Error) => (loadError = e.message),
  );

  const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

  function showMade(backup: Backup) {
    backups = [backup, ...(backups ?? []).filter((b) => b.id !== backup.id)];
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
  <button type="button" class="button primary" onclick={() => (making = true)}>New Backup</button>
</header>

<main class="page">
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if backups === null}
    <p class="muted">Loading…</p>
  {:else if backups.length === 0}
    <div class="empty">
      <p>No Backups yet.</p>
      <p class="muted">
        A Backup is a copy of Songs, the Beat Library, or both, kept here to restore from, and downloadable as one file
        to keep elsewhere.
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

{#if renaming}
  <RenameBackupDialog backup={renaming} onRenamed={showRenamed} onClose={() => (renaming = null)} />
{/if}

<style>
  .backups {
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--border);
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--border);
  }
  .about {
    display: flex;
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
  }
  .empty {
    text-align: center;
    padding: 3rem 0;
  }
  .empty p {
    margin: 0 0 0.5rem;
  }
</style>
