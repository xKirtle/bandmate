<script lang="ts">
  import { api, type Folder, type FolderSongs } from './api';
  import Dialog from './Dialog.svelte';
  import { songCount } from './listViews';

  // Deletes a Folder that holds Songs, asking whether to keep them, the
  // default, which leaves them in no Folder, or to delete them too, for good.
  // An empty Folder is deleted without asking, so never opens this.
  let {
    folder,
    onDeleted,
    onFailed,
    onClose,
  }: {
    folder: Folder;
    /** Hears the Folder as deleted, before the dialog closes. */
    onDeleted: () => void;
    /** Hears that deleting it failed, perhaps partway, e.g. to load the Songs again. */
    onFailed: () => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let songs = $state<FolderSongs>('keep');
  let deleting = $state(false);
  let error = $state<string | null>(null);
  const count = $derived(songCount(folder.songs));

  async function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    deleting = true;
    error = null;
    try {
      await api.deleteFolder(folder, songs);
      onDeleted();
      dialog?.close();
    } catch (e) {
      error = `Couldn't delete the Folder (${(e as Error).message})`;
      onFailed();
    } finally {
      deleting = false;
    }
  }
</script>

<Dialog
  bind:dialog
  title="Delete “{folder.name}”?"
  closeButton={deleting ? 'disabled' : 'shown'}
  dismissible={() => !deleting}
  oncancel={(e) => deleting && e.preventDefault()}
  onclose={onClose}
>
  <form {onsubmit}>
    <fieldset class="choice-group">
      <legend class="visually-hidden">Its Songs</legend>
      <label class="choice-row">
        <input type="radio" name="folder-songs" value="keep" bind:group={songs} />
        <span>Keep its {count}</span>
      </label>
      <p class="choice-under muted">They stay on the Songs page, in no folder.</p>
      <label class="choice-row">
        <input type="radio" name="folder-songs" value="delete" bind:group={songs} />
        <span>Delete its {count} too</span>
      </label>
      <p class="choice-under for-good">Deleted Songs, and everything in them, can't be brought back.</p>
    </fieldset>
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
    <div class="actions">
      <button type="submit" class="button danger" disabled={deleting}>
        {#if deleting}Deleting…{:else if songs === 'delete'}Delete folder and {count}{:else}Delete folder{/if}
      </button>
      <button type="button" class="button" onclick={() => dialog?.close()} disabled={deleting}>Cancel</button>
    </div>
  </form>
</Dialog>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  p {
    margin: 0;
  }
  .choice-under {
    font-size: var(--text-md);
  }
  .for-good,
  .problem {
    color: var(--danger);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
