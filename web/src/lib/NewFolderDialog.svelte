<script lang="ts">
  import { api, type Folder } from './api';
  import Dialog from './Dialog.svelte';

  // Makes an empty Folder with a name. A name another Folder has, ignoring
  // case, is refused, and the reason shown.
  let {
    onMade,
    onClose,
  }: {
    /** Hears the Folder as made, before the dialog closes. */
    onMade: (folder: Folder) => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let name = $state('');
  let making = $state(false);
  let error = $state<string | null>(null);

  async function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    making = true;
    error = null;
    try {
      onMade(await api.createFolder(name));
      dialog?.close();
    } catch (e) {
      error = `Couldn't make the Folder (${(e as Error).message})`;
    } finally {
      making = false;
    }
  }
</script>

<Dialog
  bind:dialog
  title="New folder"
  closeButton={making ? 'disabled' : 'shown'}
  dismissible={() => !making && name.trim() === ''}
  oncancel={(e) => making && e.preventDefault()}
  onclose={onClose}
>
  <form {onsubmit}>
    <label>
      Name
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={name}
        oninput={() => (error = null)}
        placeholder="e.g. Summer EP"
        autocomplete="off"
        enterkeyhint="done"
        required
        autofocus
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'new-folder-error' : undefined}
      />
    </label>
    {#if error}
      <p class="problem" id="new-folder-error" role="alert">{error}</p>
    {/if}
    <div class="actions">
      <button type="submit" class="button primary" disabled={making || name.trim() === ''}>
        {making ? 'Making…' : 'Make folder'}
      </button>
      <button type="button" class="button" onclick={() => dialog?.close()} disabled={making}>Cancel</button>
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
