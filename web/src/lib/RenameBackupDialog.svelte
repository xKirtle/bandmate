<script lang="ts">
  import { api, type Backup } from './api';
  import { automaticName } from './backups';
  import Dialog from './Dialog.svelte';

  // Gives a Backup a name of its own, shown in place of the automatic one,
  // or clears it back to the automatic one: a blank name is none.
  let {
    backup,
    onRenamed,
    onClose,
  }: {
    backup: Backup;
    /** Hears the Backup as renamed. */
    onRenamed: (backup: Backup) => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  // Taken from the Backup as the dialog opens, and not followed after.
  // svelte-ignore state_referenced_locally
  let name = $state(backup.name);
  let saving = $state(false);
  let error = $state<string | null>(null);
  const automatic = $derived(automaticName(backup));

  async function save(to: string) {
    if (to.trim() === backup.name) {
      dialog?.close();
      return;
    }
    saving = true;
    error = null;
    try {
      onRenamed(await api.renameBackup(backup.id, to));
      dialog?.close();
    } catch (e) {
      error = `Couldn't rename the Backup (${(e as Error).message})`;
    } finally {
      saving = false;
    }
  }

  function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    save(name);
  }
</script>

<Dialog
  bind:dialog
  title="Rename Backup"
  close={saving ? 'disabled' : 'shown'}
  dismissible={() => !saving && name.trim() === backup.name}
  oncancel={(e) => saving && e.preventDefault()}
  onclose={onClose}
>
  <form {onsubmit}>
    <label>
      Name
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:value={name} placeholder={automatic} autocomplete="off" enterkeyhint="done" autofocus />
    </label>
    <p class="muted">Leave it blank for the automatic name, “{automatic}”.</p>
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
    <div class="actions">
      <button type="submit" class="button primary" disabled={saving}>Save</button>
      {#if backup.name}
        <button type="button" class="button" onclick={() => save('')} disabled={saving}>Use the automatic name</button>
      {/if}
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
  .muted {
    font-size: var(--text-md);
    overflow-wrap: anywhere;
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
