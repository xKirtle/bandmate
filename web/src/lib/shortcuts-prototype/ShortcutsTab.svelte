<script lang="ts">
  // PROTOTYPE, throwaway: variant B, a Settings tab of its own. A compact
  // list on the left; the chosen Shortcut's keys edited in a panel beside it.
  import { allEntries, bindings, changed, changedCount, fresh, grouped, label, resetAll } from './engine.svelte';
  import KeysEditor from './KeysEditor.svelte';

  let query = $state('');
  const groups = $derived(grouped(query));
  let chosen = $state('record');
  const entry = $derived(allEntries().find((e) => e.id === chosen)!);
</script>

<p class="hint kept">Kept on this device. Each key does one thing.</p>
<div class="bar">
  <input class="field" type="search" placeholder="Search by name or key" bind:value={query} />
  <button type="button" class="button quiet" disabled={changedCount() === 0} onclick={resetAll}
    >Reset to defaults</button
  >
</div>
<div class="split">
  <div class="list card">
    {#each groups as { group, entries } (group)}
      <h3>{group}</h3>
      <ul>
        {#each entries as e (e.id)}
          <li>
            <button type="button" class="row" aria-pressed={chosen === e.id} onclick={() => (chosen = e.id)}>
              <span class="name"
                >{e.name}{#if changed(e.id)}<span class="dot" title="Changed">•</span>{/if}{#if fresh[e.id]}<span
                    class="new">New</span
                  >{/if}</span
              >
              <span class="keys">
                {#each bindings[e.id].flatMap((w) => w.keys) as k, i (i)}<kbd>{label(k)}</kbd>{:else}<span class="hint"
                    >No key</span
                  >{/each}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">No Shortcuts match.</p>
    {/each}
  </div>
  <section class="panel card" aria-labelledby="chosen-heading">
    <p class="hint">{entry.group}</p>
    <h2 id="chosen-heading">{entry.name}</h2>
    <p>{entry.description}</p>
    <KeysEditor {entry} align="start" />
  </section>
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
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  .bar input {
    flex: 1;
  }
  .split {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    align-items: start;
    gap: var(--space-4);
  }
  .list {
    padding: var(--space-2) var(--space-4) var(--space-4);
  }
  h3 {
    margin: var(--space-3) 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .row[aria-pressed='true'] {
    background: var(--surface-2);
  }
  .dot {
    margin-left: var(--space-1);
    color: var(--accent);
  }
  .new {
    margin-left: var(--space-2);
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .keys {
    display: flex;
    flex: none;
    gap: var(--space-1);
  }
  kbd {
    padding: 0 var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    font: inherit;
    font-size: var(--text-sm);
  }
  .panel {
    position: sticky;
    top: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .panel h2,
  .panel p {
    margin: 0;
  }
  h2 {
    font-size: var(--text-lg);
  }
</style>
