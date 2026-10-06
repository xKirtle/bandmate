<script lang="ts">
  import type { Beat } from './api';

  // Warns, in the form adding a Beat from a link, that the link's Beat is
  // already in the Library, offering to open it, or in the Beat Picker to use
  // it. Adding it anyway still works.
  let {
    beat,
    action = 'Open it',
    onOpen,
  }: {
    beat: Pick<Beat, 'title'>;
    /** What its button says, for what onOpen does with the Beat. */
    action?: string;
    onOpen: () => void;
  } = $props();
</script>

<p class="already" role="status">
  <span>“{beat.title}” is already in the Beat Library.</span>
  <button type="button" class="button quiet" onclick={onOpen}>{action}</button>
</p>

<style>
  .already {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-2);
    margin: 0;
    color: var(--warning);
    font-size: var(--text-md);
    overflow-wrap: anywhere;
  }
</style>
