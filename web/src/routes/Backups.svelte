<script lang="ts">
  // The Backups kept in Bandmate, newest first, each named from when it was
  // made and what it holds, with its size, and downloadable as one file.
  import { api, type Backup } from '../lib/api';
  import { backupName, backupSize } from '../lib/backups';
  import NewBackupDialog from '../lib/NewBackupDialog.svelte';

  let backups = $state<Backup[] | null>(null);
  let loadError = $state<string | null>(null);
  let making = $state(false);

  api.listBackups().then(
    (list) => (backups = list),
    (e: Error) => (loadError = e.message),
  );

  const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

  function showMade(backup: Backup) {
    backups = [backup, ...(backups ?? []).filter((b) => b.id !== backup.id)];
  }
</script>

<header class="bar">
  <h1>Backups</h1>
  <button type="button" class="button primary" onclick={() => (making = true)}>New Backup</button>
</header>

<main class="page">
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
              Made at {timeFormat.format(new Date(backup.createdAt))} · {backupSize(backup.size)}
            </span>
          </div>
          <a class="button" href={api.backupDownloadUrl(backup.id)} download aria-label="Download {backupName(backup)}"
            >Download</a
          >
        </li>
      {/each}
    </ul>
  {/if}
</main>

{#if making}
  <NewBackupDialog onMade={showMade} onClose={() => (making = false)} />
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
  .empty {
    text-align: center;
    padding: 3rem 0;
  }
  .empty p {
    margin: 0 0 0.5rem;
  }
</style>
