<script lang="ts">
  import { api, type SongSummary } from './api';
  import Dialog from './Dialog.svelte';
  import TagsField from './TagsField.svelte';

  // Changes a Song's Tags from the Songs page, whatever its Status: like
  // filing it in a Folder, it's organising, not editing it.
  let {
    song,
    onSaved,
    onClose,
  }: {
    song: SongSummary;
    /** Hears the Song's Tags as saved, before the dialog closes. */
    onSaved: (tags: string[]) => void;
    onClose: () => void;
  } = $props();

  const id = $props.id();
  let dialog = $state<HTMLDialogElement>();
  // Taken from the Song as the dialog opens, and not followed after.
  // svelte-ignore state_referenced_locally
  const before = song.tags;
  let tags = $state([...before]);
  let known = $state<string[]>([]);
  let saving = $state(false);
  let error = $state<string | null>(null);
  const changed = $derived(tags.length !== before.length || tags.some((t, i) => t !== before[i]));

  $effect(() => {
    api.listTags().then(
      (list) => (known = list.map((t) => t.name)),
      // Without suggestions, Tags can still be typed.
      () => {},
    );
  });

  async function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!changed) {
      dialog?.close();
      return;
    }
    saving = true;
    error = null;
    try {
      onSaved(await api.setSongTags(song.id, tags));
      dialog?.close();
    } catch (e) {
      error = `Couldn't save the Tags (${(e as Error).message})`;
    } finally {
      saving = false;
    }
  }
</script>

<Dialog
  bind:dialog
  title="Tags"
  closeButton={saving ? 'disabled' : 'shown'}
  dismissible={() => !saving && !changed}
  oncancel={(e) => saving && e.preventDefault()}
  onclose={onClose}
>
  <form {onsubmit}>
    <p class="muted" id="{id}-for">For “{song.title}”</p>
    <!-- svelte-ignore a11y_autofocus -->
    <TagsField
      autofocus
      id="{id}-tags"
      labelledby="{id}-for"
      {tags}
      {known}
      onchange={(next) => {
        tags = next;
        error = null;
      }}
    />
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
    <div class="actions">
      <button type="submit" class="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
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
  p {
    margin: 0;
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
