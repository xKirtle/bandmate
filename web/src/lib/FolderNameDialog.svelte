<script lang="ts">
  import { api, type Folder } from './api';
  import Dialog from './Dialog.svelte';

  // Names a Folder: makes an empty one with a name, or, given a Folder,
  // renames it. A name another Folder has, ignoring case, is refused, and the
  // reason shown.
  let {
    folder,
    onSaved,
    onClose,
  }: {
    /** The Folder to rename; left out, a new one is made. */
    folder?: Folder;
    /** Hears the Folder as made or renamed, before the dialog closes. */
    onSaved: (folder: Folder) => void;
    onClose: () => void;
  } = $props();

  const id = $props.id();
  let dialog = $state<HTMLDialogElement>();
  // Taken from the Folder as the dialog opens, and not followed after.
  // svelte-ignore state_referenced_locally
  const before = folder?.name ?? '';
  let name = $state(before);
  let saving = $state(false);
  let error = $state<string | null>(null);

  async function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    if (folder && name.trim() === folder.name) {
      dialog?.close();
      return;
    }
    saving = true;
    error = null;
    try {
      onSaved(await (folder ? api.renameFolder(folder.id, name) : api.createFolder(name)));
      dialog?.close();
    } catch (e) {
      error = `Couldn't ${folder ? 'rename' : 'make'} the Folder (${(e as Error).message})`;
    } finally {
      saving = false;
    }
  }
</script>

<Dialog
  bind:dialog
  title={folder ? 'Rename folder' : 'New folder'}
  closeButton={saving ? 'disabled' : 'shown'}
  dismissible={() => !saving && name.trim() === before}
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
        placeholder={folder ? undefined : 'e.g. Summer EP'}
        autocomplete="off"
        enterkeyhint="done"
        required
        autofocus
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
    </label>
    {#if error}
      <p class="problem" id="{id}-error" role="alert">{error}</p>
    {/if}
    <div class="actions">
      <button type="submit" class="button primary" disabled={saving || name.trim() === ''}>
        {#if folder}{saving ? 'Saving…' : 'Save'}{:else}{saving ? 'Making…' : 'Make folder'}{/if}
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
