<script lang="ts">
  // PROTOTYPE, throwaway: one Shortcut's keys, each a button to rebind
  // ("Press a key…", Esc cancels), with Remove, Add key and Reset.
  import X from '@lucide/svelte/icons/x';
  import {
    bindings,
    changed,
    fresh,
    keyFrom,
    label,
    messages,
    removeKey,
    resetOne,
    setKey,
    type Entry,
  } from './engine.svelte';

  let { entry, align = 'end' }: { entry: Entry; align?: 'start' | 'end' } = $props();

  let capturing = $state<{ way: number; index: number } | null>(null);
  const gesture = $derived(bindings[entry.id].flatMap((w) => w.keys)[0]?.key ?? 'drag');

  function start(way: number, index: number) {
    delete messages[entry.id];
    capturing = { way, index };
  }

  function onkeydown(e: KeyboardEvent) {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      capturing = null;
      return;
    }
    const key = keyFrom(e, entry, gesture);
    if (!key) return;
    setKey(entry.id, capturing.way, capturing.index, key);
    capturing = null;
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

<div class="editor" class:start={align === 'start'}>
  {#each bindings[entry.id] as way, w (w)}
    <div class="way">
      {#if way.label}<span class="muted">{way.label}</span>{/if}
      {#each way.keys as key, i (i)}
        {#if i > 0}<span class="muted">or</span>{/if}
        <span class="chip" class:fixed={entry.fixed}>
          {#if entry.fixed}
            <kbd>{label(key)}</kbd>
          {:else}
            <button
              type="button"
              class="key"
              class:capturing={capturing?.way === w && capturing.index === i}
              onclick={() => start(w, i)}
              onblur={() => (capturing = null)}
              title={entry.mouse ? 'Press a modifier: Shift, Alt or Ctrl/⌘' : 'Press a key'}
            >
              {capturing?.way === w && capturing.index === i ? 'Press a key…' : label(key)}
            </button>
            <button type="button" class="remove" aria-label="Remove {label(key)}" onclick={() => removeKey(entry.id, w, i)}
              ><X size={12} /></button
            >
          {/if}
        </span>
      {/each}
      {#if !entry.fixed && (!entry.mouse || way.keys.length === 0)}
        <button
          type="button"
          class="add"
          class:capturing={capturing?.way === w && capturing.index === way.keys.length}
          onclick={() => start(w, way.keys.length)}
          onblur={() => (capturing = null)}
        >
          {capturing?.way === w && capturing.index === way.keys.length
            ? entry.mouse
              ? 'Press a modifier…'
              : 'Press a key…'
            : way.keys.length
              ? '+ Add key'
              : 'No key · Add'}
        </button>
      {/if}
    </div>
  {/each}
  {#if entry.fixed}
    <span class="muted small">Can't be changed</span>
  {/if}
  {#if changed(entry.id) && !entry.fixed}
    <button type="button" class="button quiet reset" onclick={() => resetOne(entry.id)}>Reset</button>
  {/if}
  {#if messages[entry.id]}
    <span class="message" class:new={fresh[entry.id]} role="status">{messages[entry.id]}</span>
  {/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-1);
    font-size: var(--text-md);
  }
  .editor.start {
    align-items: flex-start;
  }
  .way {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
  }
  .start .way {
    justify-content: flex-start;
  }
  .muted {
    color: var(--text-muted);
  }
  .small {
    font-size: var(--text-sm);
  }
  .chip {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-1);
  }
  .chip button,
  .add {
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .key {
    padding: 0 var(--space-2);
    white-space: nowrap;
  }
  .remove {
    display: grid;
    place-items: center;
    padding: 0 var(--space-1);
    border-left: 1px solid var(--border) !important;
    color: var(--text-muted) !important;
  }
  .add {
    padding: 0 var(--space-2);
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
  }
  .capturing {
    outline: 2px solid var(--accent);
    color: var(--accent);
  }
  kbd {
    padding: 0 var(--space-2);
    font: inherit;
    white-space: nowrap;
  }
  .reset {
    min-height: 0;
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
  }
  .message {
    max-width: 20rem;
    color: var(--danger);
    font-size: var(--text-sm);
    text-align: end;
  }
  .start .message {
    text-align: start;
  }
  .message.new {
    color: var(--accent);
  }
</style>
