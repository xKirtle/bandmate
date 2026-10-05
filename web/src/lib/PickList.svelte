<script lang="ts" generics="T extends { id: number; title: string }">
  import FolderIcon from '@lucide/svelte/icons/folder';
  import { byFolder, groupTicked, tickGroup } from './pickList';

  // A list of things to pick, such as Songs, each with a checkbox, under
  // "Choose all" and "Clear". About six fit, then it scrolls. It holds no
  // picks of its own: they're the caller's, so they last as long as it keeps
  // them, even while the list isn't shown. A locked item shows ticked
  // whatever its own pick, which is kept under the lock for when it lifts.
  // Told the Folder each item sits in, it lists the Folders first, by name,
  // each with a tick for all its items and its items under it, then the
  // items in no Folder.
  let {
    items,
    picked = $bindable(),
    label,
    detail,
    locked = new Set(),
    lockedNote = '',
    folderOf,
  }: {
    items: readonly T[];
    /** The ids picked. */
    picked: Set<number>;
    /** What the list is for, for assistive tech: "Songs to back up". */
    label: string;
    /** A muted word or two after an item's title, such as a Beat's producer. */
    detail?: (item: T) => string;
    /** The ids shown ticked and locked, whatever their own pick. */
    locked?: ReadonlySet<number>;
    /** Why an item is locked, shown under it: "used by a picked Song". */
    lockedNote?: string;
    /** The name of the Folder an item sits in, or null for none, to group the items by Folder. */
    folderOf?: (item: T) => string | null;
  } = $props();
  const uid = $props.id();

  const ticked = (id: number) => locked.has(id) || picked.has(id);
  const tickedAll = $derived(items.every((item) => ticked(item.id)));
  // Clear clears every pick, those under a lock too, but only what it would
  // untick in sight enables it.
  const clearable = $derived(items.some((item) => picked.has(item.id) && !locked.has(item.id)));
  const grouped = $derived(folderOf ? byFolder(items, folderOf) : { folders: [], loose: [...items] });

  function toggle(id: number) {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    picked = next;
  }
</script>

{#snippet row(item: T)}
  {@const isLocked = locked.has(item.id)}
  {@const itemDetail = detail?.(item)}
  <li>
    <label class:locked={isLocked}>
      <input
        type="checkbox"
        checked={ticked(item.id)}
        disabled={isLocked}
        onchange={() => toggle(item.id)}
        aria-describedby={isLocked && lockedNote ? `pick-${uid}-${item.id}-note` : undefined}
      />
      <span class="text">
        <span class="title">{item.title}</span>
        {#if itemDetail}<span class="detail">· {itemDetail}</span>{/if}
        {#if isLocked && lockedNote}
          <span class="note" id="pick-{uid}-{item.id}-note">{lockedNote}</span>
        {/if}
      </span>
    </label>
  </li>
{/snippet}

<div class="pick-list">
  <div class="actions">
    <button
      type="button"
      class="button quiet"
      onclick={() => (picked = new Set(items.map((i) => i.id)))}
      disabled={tickedAll}
    >
      Choose all
    </button>
    <button type="button" class="button quiet" onclick={() => (picked = new Set())} disabled={!clearable}>Clear</button>
  </div>
  <ul aria-label={label}>
    {#each grouped.folders as group (group.folder)}
      {@const ids = group.items.map((i) => i.id)}
      {@const groupState = groupTicked(ids, ticked)}
      <li>
        <label>
          <input
            type="checkbox"
            checked={groupState === 'all'}
            indeterminate={groupState === 'some'}
            onchange={() => (picked = tickGroup(picked, ids, ticked))}
          />
          <span class="text folder"><FolderIcon /><span class="title">{group.folder}</span></span>
        </label>
        <ul class="in-folder" aria-label={group.folder}>
          {#each group.items as item (item.id)}
            {@render row(item)}
          {/each}
        </ul>
      </li>
    {/each}
    {#each grouped.loose as item (item.id)}
      {@render row(item)}
    {/each}
  </ul>
</div>

<style>
  .pick-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
  }
  .actions {
    display: flex;
    gap: var(--space-4);
  }
  /* About six, then it scrolls. */
  ul {
    max-height: calc(6.5 * var(--control));
    overflow-y: auto;
    margin: 0;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    list-style: none;
    overscroll-behavior: contain;
  }
  /* A Folder's items sit under its name, lined up with it. */
  ul.in-folder {
    max-height: none;
    overflow-y: visible;
    padding: 0 0 0 calc(var(--checkbox) + var(--space-2));
    border: 0;
    border-radius: 0;
  }
  label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control);
    padding-block: var(--space-1);
    cursor: pointer;
  }
  input {
    flex: none;
    width: var(--checkbox);
    height: var(--checkbox);
    min-height: 0;
    margin: 0;
    padding: 0;
    accent-color: var(--accent);
  }
  label.locked {
    cursor: default;
  }
  .text {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .folder {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 600;
  }
  .folder :global(.lucide-icon) {
    flex: none;
    color: var(--text-muted);
  }
  .detail,
  .note {
    color: var(--text-muted);
    font-size: var(--text-md);
  }
  .note {
    display: block;
  }
</style>
