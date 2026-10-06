<script lang="ts">
  import { api, type Tag } from './api';
  import Dialog from './Dialog.svelte';
  import { songCount } from './listViews';

  // Deletes a Tag, after saying how many Songs carry it: it comes off every
  // one of them, and no Song is deleted.
  let {
    tag,
    onDeleted,
    onClose,
  }: {
    tag: Tag;
    /** Hears the Tag as deleted, before the dialog closes. */
    onDeleted: () => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let deleting = $state(false);
  let error = $state<string | null>(null);

  async function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    deleting = true;
    error = null;
    try {
      await api.deleteTag(tag.id);
      onDeleted();
      dialog?.close();
    } catch (e) {
      error = `Couldn't delete the Tag (${(e as Error).message})`;
    } finally {
      deleting = false;
    }
  }
</script>

<Dialog
  bind:dialog
  title="Delete “{tag.name}”?"
  closeButton={deleting ? 'disabled' : 'shown'}
  dismissible={() => !deleting}
  oncancel={(e) => deleting && e.preventDefault()}
  onclose={onClose}
>
  <form {onsubmit}>
    <p>
      It comes off the {songCount(tag.songs)} carrying it. No Song is deleted.
    </p>
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
    <div class="actions">
      <button type="submit" class="button danger" disabled={deleting}>
        {deleting ? 'Deleting…' : 'Delete tag'}
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
  .problem {
    color: var(--danger);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
