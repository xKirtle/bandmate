<script lang="ts">
  // Settings' Backups tab: the Backups kept in Bandmate, newest first, each
  // named from when it was made and what it holds, or with a name of its
  // own, with its size, and downloadable as one file. A downloaded one, from
  // here or another install, can be uploaded to join them. Songs can be
  // restored from each that holds some. Each can be renamed, or deleted
  // after confirming; nothing deletes one otherwise.
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import { onDestroy, tick } from 'svelte';
  import ActionsMenu from '../lib/ActionsMenu.svelte';
  import { api, type Backup } from '../lib/api';
  import { automaticName, backupName, backupSize } from '../lib/backups';
  import type { MenuAction } from '../lib/menu';
  import { scrollBehavior } from '../lib/motion';
  import NewBackupDialog from '../lib/NewBackupDialog.svelte';
  import type { UploadProgress } from '../lib/progressUpload';
  import RenameBackupDialog from '../lib/RenameBackupDialog.svelte';
  import RestoreBackupDialog from '../lib/RestoreBackupDialog.svelte';
  import SettingsPage from '../lib/SettingsPage.svelte';

  let backups = $state<Backup[] | null>(null);
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let making = $state(false);
  let renaming = $state<Backup | null>(null);
  let restoring = $state<Backup | null>(null);
  /** The file being uploaded, while it is, and how far it has got. */
  let uploading = $state<{ file: string; progress: UploadProgress } | null>(null);
  /** Stops the upload in progress: Cancel, or leaving the tab. */
  let stopUpload: AbortController | null = null;
  /** What the last upload added, to say so, since it's listed by when it was made, maybe far down. */
  let uploaded = $state<string | null>(null);
  /** The Backup just uploaded, highlighted for a moment where it's listed. */
  let highlighted = $state<number | null>(null);
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  /** How long an uploaded Backup's row stays highlighted, in ms. */
  const highlightFor = 2000;
  let list = $state<HTMLUListElement>();

  // Switching Settings tabs, or leaving Settings, stops the upload quietly.
  onDestroy(() => {
    stopUpload?.abort();
    clearTimeout(highlightTimer);
  });

  // Closing or reloading the page would stop the upload, so ask first.
  function warnBeforeUnload(event: BeforeUnloadEvent) {
    if (uploading) event.preventDefault();
  }

  api.listBackups().then(
    (list) => (backups = list),
    (e: Error) => (loadError = e.message),
  );

  const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

  function showMade(backup: Backup) {
    uploaded = null;
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
    const stop = new AbortController();
    stopUpload = stop;
    uploading = { file: file.name, progress: { step: 'sending', sent: 0 } };
    try {
      const backup = await api.uploadBackup(file, {
        signal: stop.signal,
        onProgress: (progress) => (uploading = { file: file.name, progress }),
      });
      showUploaded(backup);
      uploaded = `Added “${backupName(backup)}” from “${file.name}”.`;
      reveal(backup.id);
    } catch (e) {
      // Cancelled: the status row just goes.
      if (!stop.signal.aborted) error = `Couldn't upload “${file.name}” (${(e as Error).message})`;
    } finally {
      uploading = null;
      stopUpload = null;
    }
  }

  /**
   * Scrolls a Backup's row into view, if it's off-screen or under the bar
   * or tab bar, and highlights it for a moment.
   */
  async function reveal(id: number) {
    await tick();
    const row = list?.querySelector<HTMLElement>(`[data-backup="${id}"]`);
    if (!row) return;
    if (!inView(row)) row.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    highlighted = id;
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => (highlighted = null), highlightFor);
  }

  /** Whether all of an element shows: in the window, below the sticky bar, and not under the tab bar. */
  function inView(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    const top = document.querySelector('.bar')?.getBoundingClientRect().bottom ?? 0;
    if (r.top < top || r.bottom > innerHeight) return false;
    const under = document.elementFromPoint(r.left + r.width / 2, r.bottom - 1);
    return under !== null && el.contains(under);
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
      { icon: Pencil, label: 'Rename…', run: () => (renaming = backup) },
      { icon: Trash2, label: 'Delete…', run: () => remove(backup) },
    ];
  }
</script>

<svelte:window onbeforeunload={warnBeforeUnload} />

{#snippet dismiss(onclick: () => void)}
  <button type="button" class="icon" {onclick} aria-label="Dismiss" title="Dismiss"><X /></button>
{/snippet}

<SettingsPage tab="backups">
  {#snippet barActions()}
    <div class="bar-actions">
      <label class="button" class:disabled={uploading !== null}>
        Upload
        <input class="visually-hidden" type="file" accept=".bandmate" onchange={upload} disabled={uploading !== null} />
      </label>
      <button type="button" class="button primary" onclick={() => (making = true)}>New Backup</button>
    </div>
  {/snippet}
  {#if error}
    <div class="message" role="alert">
      <span class="error">{error}</span>
      {@render dismiss(() => (error = null))}
    </div>
  {/if}
  {#if uploading}
    {@const { file, progress } = uploading}
    <div class="message">
      <span class="muted" role="status">
        {progress.step === 'sending'
          ? `Uploading “${file}”… ${Math.floor(progress.sent * 100)}%`
          : `Checking “${file}”…`}
      </span>
      <!-- Without a value while checking: how long that takes isn't known. -->
      {#if progress.step === 'sending'}
        <progress max="1" value={progress.sent} aria-label="How much of the Backup has been sent"></progress>
        <button type="button" class="button" onclick={() => stopUpload?.abort()}>Cancel</button>
      {:else}
        <progress aria-label="Checking the Backup"></progress>
      {/if}
    </div>
  {:else if uploaded}
    <div class="message">
      <span class="muted" role="status">{uploaded}</span>
      {@render dismiss(() => (uploaded = null))}
    </div>
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
    <ul class="backups" bind:this={list}>
      {#each backups as backup (backup.id)}
        <li data-backup={backup.id} class:highlighted={highlighted === backup.id}>
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
</SettingsPage>

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
    gap: var(--space-2);
    margin-left: auto;
  }
  /* A message over the list, with what goes with it: an upload's bar and
     Cancel, or the x that dismisses it. */
  .message {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .message > span {
    flex: 0 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .message .icon {
    margin-left: auto;
  }
  progress {
    flex: 1 1 8rem;
    accent-color: var(--accent);
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
    gap: var(--space-2) var(--space-4);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--border);
    transition: background-color var(--duration-base) var(--ease);
  }
  /* The Backup just uploaded, for a moment. */
  li.highlighted {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
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
    font-size: var(--text-md);
  }
  .row-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
  }
  .empty {
    text-align: center;
    padding: var(--space-8) 0;
  }
  .empty p {
    margin: 0 0 var(--space-2);
  }
</style>
