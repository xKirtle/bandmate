<script lang="ts" generics="T extends { id: number; title: string }">
  // A list of things to pick, such as Songs, each with a checkbox, under
  // "Choose all" and "Clear". About six fit, then it scrolls. It holds no
  // picks of its own: they're the caller's, so they last as long as it keeps
  // them, even while the list isn't shown. A locked item shows ticked
  // whatever its own pick, which is kept under the lock for when it lifts.
  let {
    items,
    picked = $bindable(),
    label,
    detail,
    locked = new Set(),
    lockedNote = '',
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
  } = $props();
  const uid = $props.id();

  const ticked = (id: number) => locked.has(id) || picked.has(id);
  const tickedAll = $derived(items.every((item) => ticked(item.id)));
  // Clear clears every pick, those under a lock too, but only what it would
  // untick in sight enables it.
  const clearable = $derived(items.some((item) => picked.has(item.id) && !locked.has(item.id)));

  function toggle(id: number) {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    picked = next;
  }
</script>

<div class="pick-list">
  <div class="actions">
    <button type="button" class="link" onclick={() => (picked = new Set(items.map((i) => i.id)))} disabled={tickedAll}>
      Choose all
    </button>
    <button type="button" class="link" onclick={() => (picked = new Set())} disabled={!clearable}>Clear</button>
  </div>
  <ul aria-label={label}>
    {#each items as item (item.id)}
      {@const isLocked = locked.has(item.id)}
      {@const more = detail?.(item)}
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
            {#if more}<span class="detail">· {more}</span>{/if}
            {#if isLocked && lockedNote}
              <span class="note" id="pick-{uid}-{item.id}-note">{lockedNote}</span>
            {/if}
          </span>
        </label>
      </li>
    {/each}
  </ul>
</div>

<style>
  .pick-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-height: 0;
  }
  .actions {
    display: flex;
    gap: 1rem;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }
  .link:disabled {
    color: var(--text-muted);
    cursor: default;
  }
  /* About six, then it scrolls. */
  ul {
    max-height: calc(6.5 * var(--control));
    overflow-y: auto;
    margin: 0;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    list-style: none;
    overscroll-behavior: contain;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--control);
    padding-block: 0.25rem;
    cursor: pointer;
  }
  input {
    flex: none;
    width: 1.25rem;
    height: 1.25rem;
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
  .detail,
  .note {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .note {
    display: block;
  }
</style>
