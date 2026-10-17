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
      {#if way.label}<span class="muted way-label">{way.label}</span>{/if}
      {#each way.keys as key, i (i)}
        {#if i > 0}<span class="muted">or</span>{/if}
        <span class="keychip" class:fixed={entry.fixed}>
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
  /* Back and Forward take one width, so their keys line up. */
  .way-label {
    min-width: 4.5rem;
  }
  .small {
    font-size: var(--text-sm);
  }
  /* A key you can click to rebind: outlined in a tint of the accent, its
     name in the accent, so it reads as a control beside plain labels. */
  .keychip {
    display: inline-flex;
    align-items: center;
    height: 1.75rem;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    line-height: 1;
  }
  .keychip.fixed {
    border-color: var(--border);
  }
  .keychip button,
  .add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    border: 0;
    background: none;
    font: inherit;
    line-height: 1;
    cursor: pointer;
  }
  .key {
    padding: 0 var(--space-2);
    color: var(--accent);
    font-weight: 600;
    white-space: nowrap;
  }
  .keychip .remove {
    width: 1.75rem;
    padding: 0;
    border-left: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--text-muted);
  }
  @media (hover: hover) {
    .key:hover,
    .keychip .remove:hover {
      background: var(--surface-2);
    }
    .keychip .remove:hover {
      color: var(--text);
    }
    .add:hover {
      color: var(--text);
    }
  }
  .add {
    height: 1.75rem;
    padding: 0 var(--space-2);
    border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border));
    border-radius: var(--radius-sm);
    color: var(--accent);
  }
  .capturing {
    outline: 2px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent) !important;
    color: var(--accent);
  }
  kbd {
    display: inline-flex;
    align-items: center;
    height: 100%;
    padding: 0 var(--space-2);
    color: var(--text-muted);
    font: inherit;
    line-height: 1;
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
