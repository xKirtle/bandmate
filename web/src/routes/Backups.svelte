<script lang="ts">
  // Settings' Backups tab: the Backups kept in Bandmate, newest first, each
  // named from when it was made and what it holds, or with a name of its
  // own, with its size, and downloadable as one file. A downloaded one, from
  // here or another install, can be uploaded to join them, picked or
  // dropped, several at once. Songs can be restored from each that holds
  // some. Each can be renamed, or deleted after confirming; nothing deletes
  // one otherwise. On a phone, a Backup's Restore and Download fold into its
  // ⋯, with Rename and Delete.
  import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
  import Download from '@lucide/svelte/icons/download';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import { onDestroy, tick } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import ActionsMenu from '../lib/ActionsMenu.svelte';
  import { api, type Backup } from '../lib/api';
  import { automaticName, backupName, backupSize } from '../lib/backups';
  import { addedNote, BackupUploads, failedNote } from '../lib/backupUploads.svelte';
  import FileDrop from '../lib/FileDrop.svelte';
  import type { MenuAction } from '../lib/menu';
  import { scrollBehavior } from '../lib/motion';
  import NewBackupDialog from '../lib/NewBackupDialog.svelte';
  import RenameBackupDialog from '../lib/RenameBackupDialog.svelte';
  import RestoreBackupDialog from '../lib/RestoreBackupDialog.svelte';
  import SettingsPage from '../lib/SettingsPage.svelte';

  let backups = $state<Backup[] | null>(null);
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let making = $state(false);
  let renaming = $state<Backup | null>(null);
  let restoring = $state<Backup | null>(null);
  /**
   * The Backups' files being uploaded, one after another. Each is listed
   * as it's added, and once they all are, they're said and shown.
   */
  const uploads = new BackupUploads<Backup>((file, options) => api.uploadBackup(file, options), {
    added: showUploaded,
    done: (added) => {
      uploaded = addedNote(added);
      reveal(added.map(({ backup }) => backup.id));
    },
  });
  /** What the last uploads added, to say so, since they're listed by when they were made, maybe far down. */
  let uploaded = $state<string | null>(null);
  /** The Backups just uploaded, highlighted for a moment where they're listed. */
  let highlighted = $state<number[]>([]);
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  /** How long uploaded Backups' rows stay highlighted, in ms. */
  const highlightFor = 2000;
  let list = $state<HTMLUListElement>();

  // Switching Settings tabs, or leaving Settings, stops the uploads quietly.
  onDestroy(() => {
    uploads.stop();
    clearTimeout(highlightTimer);
  });

  // Closing or reloading the page would stop the uploads, so ask first.
  function warnBeforeUnload(event: BeforeUnloadEvent) {
    if (uploads.current) event.preventDefault();
  }

  // Files can be dropped anywhere on the page, but not under a dialog.
  const takesFiles = $derived(!making && renaming === null && restoring === null);

  api.listBackups().then(
    (list) => (backups = list),
    (e: Error) => (loadError = e.message),
  );

  // Wider than a phone, as where the Timeline can be edited, a Backup's
  // Restore and Download are buttons beside its ⋯; on a phone they fold
  // into it.
  const wide = new MediaQuery('min-width: 40.0625rem');

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

  function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    upload(files);
  }

  /** Uploads the files picked or dropped, joining the uploads under way, if any. */
  function upload(files: File[]) {
    if (files.length === 0) return;
    error = null;
    uploaded = null;
    uploads.add(files);
  }

  /**
   * Highlights Backups' rows for a moment, and scrolls the first listed
   * into view if it's off-screen or under the bar or tab bar.
   */
  async function reveal(ids: number[]) {
    if (ids.length === 0) return;
    await tick();
    const row = [...(list?.querySelectorAll<HTMLElement>('[data-backup]') ?? [])].find((row) =>
      ids.includes(Number(row.dataset.backup)),
    );
    if (row && !inView(row)) row.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    highlighted = ids;
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => (highlighted = []), highlightFor);
  }

  /**
   * Whether all of an element shows: in the window, and with nothing over
   * its top or bottom edge, such as the sticky bar or the tab bar.
   */
  function inView(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) return false;
    const x = r.left + r.width / 2;
    return [r.top + 1, r.bottom - 1].every((y) => {
      const at = document.elementFromPoint(x, y);
      return at !== null && el.contains(at);
    });
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

  /** Whether a Backup holds anything to restore: Songs or Beats. */
  const restorable = (backup: Backup) => backup.songs > 0 || backup.beats > 0;

  /** A Backup's ⋯: Rename… and Delete…, after Restore… and Download on a phone. */
  function actions(backup: Backup): MenuAction[] {
    const folded: MenuAction[] = [];
    if (!wide.current) {
      if (restorable(backup)) folded.push({ icon: ArchiveRestore, label: 'Restore…', run: () => (restoring = backup) });
      folded.push({ icon: Download, label: 'Download', download: api.backupDownloadUrl(backup.id) });
    }
    return [
      ...folded,
      { icon: Pencil, label: 'Rename…', run: () => (renaming = backup) },
      { icon: Trash2, label: 'Delete…', run: () => remove(backup) },
    ];
  }
</script>

<svelte:window onbeforeunload={warnBeforeUnload} />

<FileDrop takes={takesFiles} label="Drop a Backup to upload it" onDrop={(data) => upload([...data.files])} />

{#snippet dismiss(onclick: () => void)}
  <button type="button" class="icon" {onclick} aria-label="Dismiss" title="Dismiss"><X /></button>
{/snippet}

<SettingsPage tab="backups">
  <section class="card" aria-labelledby="backups-heading">
    <div class="head">
      <h2 id="backups-heading">Backups</h2>
      <!-- Only once there's a list for them to add to. -->
      {#if backups !== null}
        <div class="head-actions">
          <label class="button">
            Upload
            <input class="visually-hidden" type="file" accept=".bandmate" multiple onchange={pick} />
          </label>
          <button type="button" class="button primary" onclick={() => (making = true)}>New Backup</button>
        </div>
      {/if}
    </div>
    {#if error}
      <div class="message" role="alert">
        <span class="error">{error}</span>
        {@render dismiss(() => (error = null))}
      </div>
    {/if}
    {#if uploads.failures.length > 0}
      <div class="message" role="alert">
        <span class="error">{failedNote(uploads.failures)}</span>
        {@render dismiss(() => uploads.dismissFailures())}
      </div>
    {/if}
    {#if uploads.current}
      {@const { file, progress } = uploads.current}
      <div class="message">
        <!-- The percentage is left out of what's announced, so a screen reader
             says each step once; the bar tells how far it has got. -->
        <span class="muted">
          <span role="status">{progress.step === 'sending' ? `Uploading “${file}”…` : `Checking “${file}”…`}</span>
          {#if progress.step === 'sending'}<span class="tabular" aria-hidden="true"
              >{Math.floor(progress.sent * 100)}%</span
            >{/if}
          {#if uploads.count}<span class="tabular">· {uploads.count.at} of {uploads.count.of}</span>{/if}
        </span>
        <!-- Without a value while checking: how long that takes isn't known. -->
        {#if progress.step === 'sending'}
          <progress max="1" value={progress.sent} aria-label="How much of the Backup has been sent"></progress>
          <button type="button" class="button" onclick={() => uploads.cancel()}>Cancel</button>
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
          elsewhere. Upload or drop one downloaded before, here or on another install, to restore from it.
        </p>
      </div>
    {:else}
      <ul class="backups" bind:this={list}>
        {#each backups as backup (backup.id)}
          <li data-backup={backup.id} class:highlighted={highlighted.includes(backup.id)}>
            <div class="about">
              <span class="name">{backupName(backup)}</span>
              <span class="muted details">
                {#if backup.name}{automaticName(backup)} ·{/if}
                Made at {timeFormat.format(new Date(backup.createdAt))} · {backupSize(backup.size)}
              </span>
            </div>
            <div class="row-actions">
              {#if wide.current}
                {#if restorable(backup)}
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
              {/if}
              <ActionsMenu label="More actions for {backupName(backup)}" entries={actions(backup)} />
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
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
  /* Everything sits in from the card's edges, but its rows run to them, so
     a highlight fills the row. */
  .head,
  .message,
  .card > p,
  .empty {
    padding-inline: var(--space-4);
  }
  /* Where they don't fit beside the heading, as on a phone, the buttons go
     under it, still on the right. */
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    padding-block: var(--space-4);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  .head-actions {
    display: flex;
    flex: none;
    gap: var(--space-2);
    margin-left: auto;
  }
  /* Loading, or why it couldn't. */
  .card > p {
    margin: 0;
    padding-bottom: var(--space-4);
  }
  /* A message between the header and the list, with what goes with it: an upload's bar and
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
  /* A long message, such as several files that couldn't be uploaded, wraps
     beside its x rather than pushing it onto a line of its own. */
  .message:has(> .icon) > span {
    flex: 1 1 0;
  }
  progress {
    flex: 1 1 8rem;
    accent-color: var(--accent);
  }
  .backups {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    /* Where the name would be squeezed, as at phone width, the buttons go under it. */
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-3) var(--space-4);
    transition: background-color var(--duration-base) var(--ease);
  }
  /* Rows are divided from each other; the card's own border edges the last. */
  li + li {
    border-top: 1px solid var(--border);
  }
  /* So the last row's highlight follows the card's corners. */
  li:last-child {
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  }
  /* The Backups just uploaded, for a moment. */
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
    padding-block: var(--space-4) var(--space-8);
    text-align: center;
  }
  .empty p {
    margin: 0 0 var(--space-2);
  }
</style>
