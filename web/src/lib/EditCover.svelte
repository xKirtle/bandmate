<script lang="ts">
  import { api, type Cover, type PreparedCover, type Song, type SongAt, type Status } from './api';
  import ActionsMenu from './ActionsMenu.svelte';
  import type { Square } from './cover';
  import CoverCrop from './CoverCrop.svelte';
  import CoverPlaceholder from './CoverPlaceholder.svelte';
  import { cropCover, openCover, reopenCover, type CoverToCrop } from './coverUpload';
  import SongCover from './SongCover.svelte';

  // The header's Cover in Write mode. Without one, the placeholder is a
  // button to pick a picture for it; with one, the Cover opens a menu to
  // adjust its crop, change its picture or remove it. A picture picked opens
  // the crop step, as does adjusting the crop, on the Cover's original.
  let {
    songId,
    cover,
    title,
    status,
    change,
    onError,
  }: {
    songId: number;
    cover: Cover | null;
    title: string;
    status: Status;
    /** Sends a change to the Song; resolves to whether it succeeded. */
    change: (op: (at: SongAt) => Promise<Song>) => Promise<boolean>;
    /** Shows why a picture couldn't be used. */
    onError: (message: string) => void;
  } = $props();

  let busy = $state<string | null>(null);
  // The crop step, open on a picture picked or on the Cover's original to
  // adjust its crop: the square it opens on, what confirming is called and
  // what it does.
  let toCrop = $state<{
    picture: CoverToCrop;
    initial?: Square;
    confirmLabel: string;
    confirm: (crop: Square) => void;
  } | null>(null);
  let changeInput = $state<HTMLInputElement>();

  // The limit is checked on the picture chosen, before it's scaled down, so
  // it's waited for. Without it, the server still enforces its own.
  const maxCoverBytes = api.getConfig().then(
    (c) => c.maxCoverBytes,
    () => Infinity,
  );

  async function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await run('Opening…', async () => {
      const picture = await openCover(file, await maxCoverBytes);
      toCrop = {
        picture,
        confirmLabel: cover ? 'Change Cover' : 'Add Cover',
        confirm: (crop) => put(picture, crop),
      };
    });
  }

  // Adds the Cover, or replaces the one the Song has.
  async function put(picture: CoverToCrop, crop: Square) {
    toCrop = null;
    const replacing = cover !== null;
    await run(replacing ? 'Changing…' : 'Adding…', async () => {
      const prepared = await cropCover(picture, crop);
      const send = replacing ? api.replaceCover : api.addCover;
      await change((at) => send(at, prepared));
    });
  }

  // Opens the crop step on the Cover's original, at its current square.
  async function reopen() {
    if (!cover) return;
    const { id, width, height, crop } = cover;
    await run('Opening…', async () => {
      const picture = await reopenCover(api.coverUrl(songId, id, 'original'), { width, height });
      toCrop = { picture, initial: crop, confirmLabel: 'Save crop', confirm: (crop) => adjust(id, picture, crop) };
    });
  }

  // Shows a new square of the Cover's original, the one with id from.
  async function adjust(from: number, picture: CoverToCrop, crop: Square) {
    toCrop = null;
    await run('Saving…', async () => {
      const { list, header } = await cropCover(picture, crop);
      await change((at) => api.adjustCoverCrop(at, from, { list, header, crop }));
    });
  }

  async function remove() {
    if (!confirm("Remove this Cover?\n\nIts pictures are deleted. This can't be undone.")) return;
    await run('Removing…', async () => {
      await change((at) => api.removeCover(at));
    });
  }

  async function run(label: string, work: () => Promise<void>) {
    busy = label;
    try {
      await work();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      busy = null;
    }
  }

  const entries = [
    { icon: '⛶', label: 'Adjust crop', run: reopen },
    { icon: '↻', label: 'Change picture', run: () => changeInput?.click() },
    { icon: '🗑', label: 'Remove', run: remove },
  ];
</script>

{#if cover}
  <div class="cover" class:busy={busy !== null} aria-busy={busy !== null}>
    <ActionsMenu label="Cover" align="start" {entries} disabled={busy !== null || toCrop !== null}>
      {#snippet trigger()}
        <SongCover {songId} coverId={cover.id} {title} {status} size="header" />
      {/snippet}
    </ActionsMenu>
    {#if busy}
      <span class="caption">{busy}</span>
    {/if}
    <input
      class="visually-hidden"
      type="file"
      accept="image/*"
      tabindex="-1"
      aria-hidden="true"
      bind:this={changeInput}
      onchange={pick}
    />
  </div>
{:else}
  <label class="cover add" class:busy={busy !== null} aria-busy={busy !== null}>
    <CoverPlaceholder {title} {status} size="header" />
    <span class="caption">{busy ?? 'Add Cover'}</span>
    <input
      class="visually-hidden"
      type="file"
      accept="image/*"
      onchange={pick}
      disabled={busy !== null || toCrop !== null}
    />
  </label>
{/if}

{#if toCrop}
  <CoverCrop
    picture={toCrop.picture}
    initial={toCrop.initial}
    confirmLabel={toCrop.confirmLabel}
    onConfirm={toCrop.confirm}
    onCancel={() => (toCrop = null)}
  />
{/if}

<style>
  .cover {
    --trigger-radius: calc(var(--cover-header) * 0.18);
    position: relative;
    display: block;
    flex: none;
    border-radius: var(--trigger-radius);
  }
  .add {
    cursor: pointer;
  }
  .add:focus-within,
  .cover :global(button[aria-haspopup]:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .busy,
  .busy :global(button:disabled) {
    cursor: progress;
  }
  /* Along the bottom of the Cover, over its initial's lower edge. */
  .caption {
    position: absolute;
    inset: auto 0 0;
    padding: 0.375rem 0;
    border-radius: 0 0 var(--trigger-radius) var(--trigger-radius);
    background: color-mix(in srgb, var(--surface-1) 85%, transparent);
    color: var(--text);
    font-size: var(--text-md);
    font-weight: 600;
    text-align: center;
    pointer-events: none;
  }
  .add:hover .caption {
    background: var(--surface-1);
  }
</style>
