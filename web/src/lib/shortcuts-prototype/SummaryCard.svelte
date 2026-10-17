<script lang="ts">
  // PROTOTYPE, throwaway: variant C. This device only sums Shortcuts up; the
  // keys are changed in the shortcuts dialog, the same one as on a Song page.
  import ShortcutsDialog from '../ShortcutsDialog.svelte';
  import { changedCount } from './engine.svelte';

  let open = $state(false);
</script>

<section class="card" id="shortcuts" aria-labelledby="shortcuts-heading">
  <h2 id="shortcuts-heading">Shortcuts</h2>
  <p class="hint">
    {changedCount() === 0
      ? 'The default keys, on a Song page.'
      : `${changedCount()} changed from the defaults.`}
  </p>
  <div>
    <button type="button" class="button" onclick={() => (open = true)}>Change keys</button>
  </div>
</section>

{#if open}
  <ShortcutsDialog editing onClose={() => (open = false)} />
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  p {
    margin: 0;
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
</style>
