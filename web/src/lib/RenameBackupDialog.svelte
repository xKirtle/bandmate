<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Backup } from './api';
  import { closeOnBackdrop } from './backdrop';
  import { automaticName } from './backups';

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

  onMount(() => dialog?.showModal());

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

<dialog
  bind:this={dialog}
  {@attach closeOnBackdrop(() => !saving && name.trim() === backup.name)}
  oncancel={(e) => saving && e.preventDefault()}
  onclose={onClose}
  aria-labelledby="rename-backup-heading"
>
  <header>
    <h2 id="rename-backup-heading">Rename Backup</h2>
    <button type="button" class="icon" onclick={() => dialog?.close()} disabled={saving} aria-label="Close">✕</button>
  </header>

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
</dialog>

<style>
  dialog {
    width: min(28rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--bg);
    color: var(--text);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  dialog::backdrop {
    background: var(--scrim);
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  h2 {
    margin: 0;
    font-size: var(--text-xl);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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
    gap: 0.5rem;
  }
</style>
