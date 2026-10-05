<script lang="ts">
  // Files dragged from the computer and dropped anywhere on the page, for a
  // page that takes them: while they're dragged over it, the whole window
  // shows it'll take them, saying what a drop does. A drop the page doesn't
  // take, now or ever, is never opened by the browser in its place.
  import { draggedFiles } from './fileDrop';

  interface Props {
    /** Whether a drop would be taken now. */
    takes: boolean;
    /** What dropping does, shown while files are dragged over the page. */
    label: string;
    /**
     * Told of each drop taken, while it's handled: once that's over, the
     * drop is emptied, so what it holds must be asked for straight away.
     */
    onDrop: (data: DataTransfer) => void;
  }

  let { takes, label, onDrop }: Props = $props();

  // Entering one of the page's elements fires before leaving the last, so
  // the drag is over the page until it's left as many times as entered.
  let dragDepth = $state(0);
  const shown = $derived(takes && dragDepth > 0);

  function filesEnter(event: DragEvent) {
    if (draggedFiles(event)) dragDepth++;
  }

  function filesLeave(event: DragEvent) {
    if (draggedFiles(event)) dragDepth = Math.max(0, dragDepth - 1);
  }

  function filesOver(event: DragEvent) {
    const data = draggedFiles(event);
    if (!data) return;
    event.preventDefault();
    data.dropEffect = takes ? 'copy' : 'none';
  }

  function filesDrop(event: DragEvent) {
    const data = draggedFiles(event);
    if (!data) return;
    event.preventDefault();
    dragDepth = 0;
    if (takes) onDrop(data);
  }
</script>

<svelte:window ondragenter={filesEnter} ondragleave={filesLeave} ondragover={filesOver} ondrop={filesDrop} />

{#if shown}
  <div class="drop-target" aria-hidden="true"><p>{label}</p></div>
{/if}

<style>
  /* The window, nav rail and all, while files dropped anywhere on it would be taken. */
  .drop-target {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    box-shadow: var(--selected-outline);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    pointer-events: none;
  }
  .drop-target p {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text);
    font-weight: 600;
  }
</style>
