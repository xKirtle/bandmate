<script lang="ts">
  // PROTOTYPE, throwaway: variant B, a Settings tab of its own. One column,
  // each group a card, each Shortcut a fold: closed, its name and keys;
  // open, what it does, where it works, and its keys to rebind.
  import FoldChevron from '../FoldChevron.svelte';
  import { bindings, changed, changedCount, fresh, grouped, label, resetAll } from './engine.svelte';
  import KeysEditor from './KeysEditor.svelte';

  let query = $state('');
  const groups = $derived(grouped(query));

  // Where each works, for the open fold. Prototype copy.
  const where: Record<string, string> = {
    playPause: 'Anywhere on the Song page, unless the focused control uses Space itself.',
    record: 'Anywhere on the Song page but a text field.',
    startOrEnd: 'Anywhere but a text field, a list, a slider, a menu or a dialog.',
    undo: 'Anywhere but a text field or a dialog, in Read mode too.',
    redo: 'Anywhere but a text field or a dialog, in Read mode too.',
    openShortcuts: 'Anywhere on the Song page.',
    deleteClip: 'The Timeline.',
    clipMenu: 'A focused Clip.',
    seek: 'The ruler, once it has focus.',
    seekFar: 'The ruler, once it has focus.',
    nudgeCue: 'A focused Cue field, in Write mode.',
    selectAll: 'The Timeline, not in a text field.',
    clearSelection: 'The Timeline.',
    copyClips: 'The Timeline, not in a text field.',
    cutClips: 'The Timeline, not in a text field.',
    pasteClips: 'The Timeline, not in a text field.',
    splitClips: 'Anywhere on the Song page, while editing and not recording.',
    cueNextLine: 'Sync mode, anywhere but a text field, a dialog or a menu.',
    toggleClip: 'A Clip.',
    boxSelect: 'Empty space in a lane.',
    addBox: 'Empty space in a lane.',
    nudgeTake: 'Dragging a Clip.',
    skipSnapping: 'Dragging a Clip, the Loop or a gain line, where it also fine-tunes the gain.',
    zoom: 'The lanes and the scroll bar. Pinching always zooms too.',
  };
</script>

<p class="hint kept">Kept on this device. Each key does one thing, anywhere on a Song page.</p>
<div class="bar">
  <input class="field" type="search" placeholder="Search by name or key, e.g. Record or Shift" bind:value={query} />
  <button type="button" class="button quiet" disabled={changedCount() === 0} onclick={resetAll}
    >Reset to defaults</button
  >
</div>

<div class="cards">
  {#each groups as { group, entries } (group)}
    <section class="card" aria-label={group}>
      <h2>{group}</h2>
      {#each entries as e (e.id)}
        <details open={!!fresh[e.id] || undefined}>
          <summary>
            <FoldChevron />
            <span class="name">{e.name}</span>
            {#if fresh[e.id]}<span class="badge new">New</span>{/if}
            {#if changed(e.id) && !fresh[e.id]}<span class="hint">Changed</span>{/if}
            <span class="keys">
              {#each bindings[e.id].flatMap((w) => w.keys) as k, i (i)}<kbd>{label(k)}</kbd>{:else}<span
                  class="hint">No key</span
                >{/each}
            </span>
          </summary>
          <div class="body">
            <p>{e.description}</p>
            <p class="hint"><strong>Works in</strong> {where[e.id] ?? e.group}</p>
            <KeysEditor entry={e} align="start" />
          </div>
        </details>
      {/each}
    </section>
  {:else}
    <p class="hint">No Shortcuts match.</p>
  {/each}
</div>

<style>
  .kept {
    margin: 0 0 var(--space-4);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .bar input {
    flex: 1 1 16rem;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .card {
    display: flex;
    flex-direction: column;
    padding: var(--space-2) var(--space-4);
  }
  h2 {
    margin: var(--space-2) 0;
    font-size: var(--text-lg);
  }
  details {
    border-top: 1px solid var(--border);
  }
  summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control);
    padding: var(--space-2) 0;
    cursor: pointer;
  }
  .name {
    font-weight: 600;
  }
  .new {
    background: var(--accent);
    color: var(--accent-text);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-1);
    margin-left: auto;
  }
  kbd {
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    font: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 0 var(--space-4) calc(var(--space-2) + 1.5rem);
  }
  .body p {
    margin: 0;
  }
</style>
