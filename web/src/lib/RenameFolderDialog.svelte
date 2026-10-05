<script lang="ts">
  import { api, type Folder } from './api';
  import Dialog from './Dialog.svelte';

  // Gives a Folder a new name. A name another Folder has, ignoring case, is
  // refused, and the reason shown.
  let {
    folder,
    onRenamed,
    onClose,
  }: {
    folder: Folder;
    /** Hears the Folder as renamed, before the dialog closes. */
    onRenamed: (folder: Folder) => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  // Taken from the Folder as the dialog opens, and not followed after.
  // svelte-ignore state_referenced_locally
  let name = $state(folder.name);
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    if (name.trim() === folder.name) {
      dialog?.close();
      return;
    }
    saving = true;
    error = null;
    try {
      onRenamed(await api.renameFolder(folder.id, name));
      dialog?.close();
    } catch (e) {
      error = `Couldn't rename the Folder (${(e as Error).message})`;
    } finally {
      saving = false;
    }
  }
</script>

<Dialog
  bind:dialog
  title="Rename folder"
  closeButton={saving ? 'disabled' : 'shown'}
  dismissible={() => !saving && name.trim() === folder.name}
  oncancel={(e) => saving && e.preventDefault()}
  onclose={onClose}
>
  <form {onsubmit}>
    <label>
      Name
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={name}
        oninput={() => (error = null)}
        autocomplete="off"
        enterkeyhint="done"
        required
        autofocus
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'rename-folder-error' : undefined}
      />
    </label>
    {#if error}
      <p class="problem" id="rename-folder-error" role="alert">{error}</p>
    {/if}
    <div class="actions">
      <button type="submit" class="button primary" disabled={saving || name.trim() === ''}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" class="button" onclick={() => dialog?.close()} disabled={saving}>Cancel</button>
    </div>
  </form>
</Dialog>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-weight: 600;
  }
  label input {
    font-weight: normal;
  }
  p {
    margin: 0;
  }
  .problem {
    color: var(--danger);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
