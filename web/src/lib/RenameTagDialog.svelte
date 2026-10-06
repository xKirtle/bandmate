<script lang="ts">
  import { ApiError, api, type Tag } from './api';
  import Dialog from './Dialog.svelte';

  // Renames a Tag, which every Song carrying it then shows. A name another
  // Tag has, ignoring case, merges the two, but only once the user has said
  // so: the server refuses it first, and the dialog asks.
  let {
    tag,
    onSaved,
    onClose,
  }: {
    tag: Tag;
    /** Hears the Tag as renamed, or merged into, before the dialog closes. */
    onSaved: (tag: Tag) => void;
    onClose: () => void;
  } = $props();

  const id = $props.id();
  let dialog = $state<HTMLDialogElement>();
  // Taken from the Tag as the dialog opens, and not followed after.
  // svelte-ignore state_referenced_locally
  const before = tag.name;
  let name = $state(before);
  let saving = $state(false);
  let error = $state<string | null>(null);
  // Why the name merges the Tag into another, once the server has said so;
  // asked about before merging.
  let merging = $state<string | null>(null);

  async function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    if (name.trim() === before) {
      dialog?.close();
      return;
    }
    saving = true;
    error = null;
    try {
      onSaved(await api.renameTag(tag.id, name, merging !== null));
      dialog?.close();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && merging === null)
        merging = e.message.charAt(0).toUpperCase() + e.message.slice(1);
      else error = `Couldn't ${merging ? 'merge' : 'rename'} the Tag (${(e as Error).message})`;
    } finally {
      saving = false;
    }
  }
</script>

<Dialog
  bind:dialog
  title="Rename tag"
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
        oninput={() => {
          error = null;
          merging = null;
        }}
        autocomplete="off"
        enterkeyhint="done"
        required
        autofocus
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : merging ? `${id}-merge` : undefined}
      />
    </label>
    {#if merging}
      <p id="{id}-merge" role="alert">
        {merging}. Merge them? Every Song carrying “{before}” will carry “{name.trim()}” instead.
      </p>
    {/if}
    {#if error}
      <p class="problem" id="{id}-error" role="alert">{error}</p>
    {/if}
    <div class="actions">
      <button type="submit" class="button primary" disabled={saving || name.trim() === ''}>
        {#if merging}{saving ? 'Merging…' : 'Merge tags'}{:else}{saving ? 'Saving…' : 'Save'}{/if}
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
