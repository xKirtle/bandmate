<script lang="ts">
  // The Snapshots dialog, opened from Write mode: a Song's Snapshots, newest
  // first, beside the one chosen, read-only and set beside the Song as it is
  // now, with Restore at its foot. ‹ › and ↑ ↓ step to the older or newer
  // one. On a phone, the list comes first, then the Snapshot over it, with a
  // way back to the list.
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Lock from '@lucide/svelte/icons/lock';
  import { SvelteSet } from 'svelte/reactivity';
  import { api, type Snapshot, type SnapshotSummary } from './api';
  import Dialog from './Dialog.svelte';
  import { type Sheet } from './snapshotDiff';
  import ThenAndNow from './ThenAndNow.svelte';
  import { snapshotGroups, snapshotReason, stepSnapshot, type SnapshotStep } from './snapshots';
  import { formatWhen } from './time';

  let {
    songId,
    current,
    restore,
    onClose,
  }: {
    songId: number;
    /** The Song's Lyric Sheet and Scrapbook as saved, to set each Snapshot beside. */
    current: Sheet;
    /** Restores a Snapshot, resolving once it's saved or not. */
    restore: (snapshotId: number) => Promise<unknown>;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let list = $state<SnapshotSummary[] | null>(null);
  let listError = $state<string | null>(null);
  let index = $state(0);
  /** The Snapshots read so far, by id. */
  let read = $state<Record<number, Snapshot>>({});
  let readError = $state<string | null>(null);
  /** On a phone, the chosen Snapshot shows over the list. */
  let showing = $state(false);
  let restoring = $state(false);
  let keepError = $state<string | null>(null);
  /** The Snapshots being kept or un-kept, whose Keep waits till that's saved. */
  const keeping = new SvelteSet<number>();
  const uid = $props.id();

  const chosen = $derived(list?.[index] ?? null);
  const snapshot = $derived(chosen ? (read[chosen.id] ?? null) : null);
  const now = new Date();

  const failed = (e: unknown) => (e instanceof Error ? e.message : String(e));

  $effect(() => {
    api.listSnapshots(songId).then(
      (l) => (list = l),
      (e) => (listError = failed(e)),
    );
  });

  // Reads the chosen Snapshot, once.
  $effect(() => {
    const id = chosen?.id;
    if (id === undefined || read[id]) return;
    readError = null;
    api.getSnapshot(songId, id).then(
      (s) => (read = { ...read, [s.id]: s }),
      (e) => {
        if (chosen?.id === id) readError = failed(e);
      },
    );
  });

  function step(to: SnapshotStep) {
    if (list) index = stepSnapshot(index, to, list.length);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    step(e.key === 'ArrowDown' ? 'older' : 'newer');
  }

  /** Keeps a Snapshot, or un-keeps it, showing it at once and putting it back if that fails. */
  async function keep(s: SnapshotSummary) {
    const kept = !s.kept;
    keepError = null;
    keeping.add(s.id);
    s.kept = kept;
    try {
      await api.keepSnapshot(songId, s.id, kept);
    } catch (e) {
      s.kept = !kept;
      keepError = failed(e);
    } finally {
      keeping.delete(s.id);
    }
  }

  async function restoreChosen() {
    if (!chosen) return;
    restoring = true;
    try {
      await restore(chosen.id);
    } finally {
      dialog?.close();
    }
  }

  /** Keeps the chosen Snapshot's row in view as ↑ ↓ step through the list. */
  function inView(el: HTMLElement) {
    el.scrollIntoView({ block: 'nearest' });
  }
</script>

<Dialog
  title="Snapshots"
  sheet
  fill
  stack={false}
  bind:dialog
  dismissible={() => !restoring}
  closeButton={restoring ? 'disabled' : 'shown'}
  onclose={onClose}
  {onkeydown}
  --dialog-width="min(72rem, calc(100vw - 4rem))"
  --dialog-height="min(48rem, calc(100dvh - 4rem))"
>
  {#if listError}
    <p class="error" role="alert">{listError}</p>
  {:else if list === null}
    <p class="muted">Loading…</p>
  {:else if list.length === 0}
    <p class="muted">
      No Snapshots yet. Bandmate takes one of the Lyric Sheet and Scrapbook before each editing session, once a Song has
      a Section.
    </p>
  {:else}
    <div class="snapshots" class:showing>
      <div class="snapshot-list">
        {#if keepError}<p class="error" role="alert">{keepError}</p>{/if}
        {#each snapshotGroups(list, now) as group, g (group.name)}
          <h3 id="{uid}-group-{g}">{group.name}</h3>
          <ul aria-labelledby="{uid}-group-{g}">
            {#each group.items as { snapshot: s, index: i } (s.id)}
              {@const why = snapshotReason(s)}
              <li>
                <button
                  type="button"
                  class="snapshot-pick"
                  aria-current={i === index ? 'true' : undefined}
                  onclick={() => {
                    index = i;
                    showing = true;
                  }}
                  {@attach (el) => {
                    if (i === index) inView(el);
                  }}
                >
                  <span class="tabular">{formatWhen(s.takenAt, now)}</span>
                  {#if why}<span class="snapshot-why">{why}</span>{/if}
                </button>
                <button
                  type="button"
                  class="icon snapshot-keep"
                  aria-pressed={s.kept}
                  disabled={keeping.has(s.id)}
                  aria-label="Keep"
                  title={s.kept ? 'Kept: it’s never thinned' : 'Keep it, so it’s never thinned'}
                  onclick={() => keep(s)}><Lock /></button
                >
              </li>
            {/each}
          </ul>
        {/each}
      </div>
      {#if chosen}
        <div class="snapshot-preview">
          <div class="snapshot-head">
            <button
              type="button"
              class="icon snapshot-back"
              aria-label="Back to the list"
              onclick={() => (showing = false)}><ChevronLeft /></button
            >
            <button
              type="button"
              class="icon"
              aria-label="Older Snapshot"
              title="Older Snapshot (↓)"
              disabled={index === list.length - 1}
              onclick={() => step('older')}><ChevronLeft /></button
            >
            <div class="snapshot-when">
              <strong class="tabular">{formatWhen(chosen.takenAt, now)}</strong>
              {#if snapshotReason(chosen)}<span class="snapshot-why">{snapshotReason(chosen)}</span>{/if}
            </div>
            <button
              type="button"
              class="icon"
              aria-label="Newer Snapshot"
              title="Newer Snapshot (↑)"
              disabled={index === 0}
              onclick={() => step('newer')}><ChevronRight /></button
            >
          </div>
          <div class="snapshot-scroll">
            {#if snapshot}
              <ThenAndNow then={snapshot.sheet} now={current} when={formatWhen(chosen.takenAt, now)} />
            {:else if readError}
              <p class="error" role="alert">{readError}</p>
            {:else}
              <p class="muted">Loading…</p>
            {/if}
          </div>
          <div class="snapshot-foot">
            <p class="muted">
              Restoring makes your Lyric Sheet and Scrapbook this Snapshot’s. What you have now is kept as a Snapshot
              first, so you can go back.
            </p>
            <button type="button" class="button primary" disabled={!snapshot || restoring} onclick={restoreChosen}
              >Restore this Snapshot</button
            >
          </div>
        </div>
      {/if}
    </div>
  {/if}
</Dialog>

<style>
  /* The list beside the chosen Snapshot, each scrolling on its own, so the
     Snapshot's head and foot stay in view. */
  .snapshots {
    display: grid;
    grid-template-columns: 16rem minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    gap: var(--space-4);
    height: 100%;
  }
  .snapshot-list {
    padding: 0 var(--space-2) 0 0;
    border-right: 1px solid var(--border);
    overflow: auto;
  }
  .snapshot-list h3 {
    margin: var(--space-3) 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .snapshot-list h3:first-of-type {
    margin-top: 0;
  }
  .snapshot-list ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .snapshot-list li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .snapshot-pick {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .snapshot-pick[aria-current='true'] {
    background: var(--surface-2);
    box-shadow: var(--selected-edge);
  }
  .snapshot-why {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  /* A kept Snapshot's lock is in the accent, as a toggle that's on. */
  .snapshot-keep[aria-pressed='true'] {
    color: var(--accent);
  }
  .snapshot-preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-height: 0;
  }
  .snapshot-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .snapshot-when {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .snapshot-back {
    display: none;
  }
  /* Selectable, to copy a Line back by hand. */
  .snapshot-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    user-select: text;
  }
  .snapshot-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .snapshot-foot p {
    flex: 1 1 20rem;
    margin: 0;
    font-size: var(--text-sm);
  }
  /* A phone: the list first, then the chosen Snapshot over it. */
  @media (width < 40rem) {
    .snapshots {
      grid-template-columns: minmax(0, 1fr);
    }
    .snapshot-list {
      padding: 0;
      border: 0;
    }
    .snapshot-preview,
    .showing .snapshot-list {
      display: none;
    }
    .showing .snapshot-preview {
      display: flex;
    }
    .snapshot-back {
      display: inline-flex;
    }
  }
</style>
