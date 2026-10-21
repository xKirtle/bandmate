<script lang="ts">
  // One Shortcut's keys, in its fold in Settings' Shortcuts tab. A keyboard
  // Shortcut's are each a button that, clicked, waits for the next key
  // pressed ("Press a key…", Esc cancels), with an x to take it off, then
  // Add key. A two-way Shortcut's Back and Forward keys are listed on their
  // own. A mouse Shortcut changes only what's held, never its gesture:
  // "Hold Ctrl Alt Shift and drag", each modifier a toggle, at least one
  // on; the plain drag that selects with a box can't be changed at all. A
  // key or a modifier that's refused says why under them, naming the
  // Shortcut that has it as a button leading there, and a key keeps waiting
  // for another try.
  //
  // Which slot is waiting, what's showing and when each goes are
  // rebinding.svelte.ts's rules; this draws them, and tells it of the
  // presses, clicks and focus it hears.
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { tick } from 'svelte';
  import { Rebinding } from './rebinding.svelte';
  import { shortcutKeys } from './sharedShortcutKeys.svelte';
  import { keysLabel, modifierName, modifiers, platform, shortcuts, type Gesture, type Key } from './shortcuts';
  import {
    defaultKeyset,
    heldWith,
    isChanged,
    isFixed,
    isMouse,
    keysIn,
    listsOf,
    type KeyList,
    type ShortcutId,
  } from './shortcutKeys';

  let { id, onreveal }: { id: ShortcutId; onreveal: (id: ShortcutId) => void } = $props();

  const uid = $props.id();
  const on = platform();
  let root = $state<HTMLElement>();
  const rebinding = new Rebinding({ id: () => id, keys: shortcutKeys, on });

  const lists = $derived(listsOf(id));
  /** What a mouse Shortcut is held with, or null for a keyboard one. */
  const held = $derived(isMouse(id) ? heldWith(shortcutKeys.value.keys, id) : null);
  const gestures: Record<Gesture, string> = { click: 'click', drag: 'drag', wheel: 'scroll the wheel' };
  const names: Record<KeyList, string> = { keys: 'Keys', back: 'Back', forward: 'Forward' };
  const label = (key: Key) => keysLabel([key], on);

  function onkeydown(event: KeyboardEvent) {
    if (rebinding.takesPress(event)) {
      // The key is for choosing, not for the button or the page.
      event.preventDefault();
      event.stopPropagation();
    }
    rebinding.press(event);
  }

  // Space would click the button again as it's let go.
  function onkeyup(event: KeyboardEvent) {
    if (rebinding.listening) event.preventDefault();
  }

  // Only this knows where focus went: the button naming the Shortcut that
  // has the key refused is the one that keeps the message (see .holder).
  function onfocusout(event: FocusEvent) {
    const to = event.relatedTarget;
    rebinding.focusLeft(to instanceof Element && to.closest('.holder') ? 'holder' : 'elsewhere');
  }

  async function remove(list: KeyList, index: number) {
    rebinding.remove(list, index);
    // The key's buttons are gone: Add key takes the focus they had.
    await tick();
    root?.querySelector<HTMLElement>(`[data-add="${list}"]`)?.focus();
  }

  function escape(event: KeyboardEvent) {
    rebinding.escape(event);
  }

  function reveal(by: ShortcutId) {
    rebinding.holderRevealed();
    onreveal(by);
  }
</script>

<div class="editor" bind:this={root} {onfocusout}>
  {#if isFixed(id)}
    <p class="fixed">
      <kbd>{keysLabel(keysIn(defaultKeyset, id, 'keys'), on)}</kbd>
      <span class="hint">Can't be changed</span>
    </p>
  {:else if held}
    <div class="held" role="group" aria-label="Held with the mouse">
      <span>Hold</span>
      {#each modifiers as modifier (modifier)}
        <button
          type="button"
          class="button toggle"
          aria-pressed={held[modifier]}
          aria-describedby={rebinding.message ? `${uid}-message` : undefined}
          onclick={() => rebinding.toggle(modifier)}
          onkeydown={escape}>{modifierName(modifier, on)}</button
        >
      {/each}
      <span>and {gestures[held.gesture]}</span>
    </div>
  {:else}
    <div class="lists" class:two-way={lists.length > 1}>
      {#each lists as list (list)}
        {@const keys = keysIn(shortcutKeys.value.keys, id, list)}
        <div class="list" role="group" aria-labelledby="{uid}-{list}">
          <span class="way" class:visually-hidden={lists.length === 1} id="{uid}-{list}">{names[list]}</span>
          <span class="keys">
            {#each keys as key, k (k)}
              <span class="key" class:listening={rebinding.isListening(list, k)}>
                <button
                  type="button"
                  class="rebind"
                  aria-label={rebinding.isListening(list, k) ? 'Press a key' : `Change ${label(key)}`}
                  aria-describedby={rebinding.message ? `${uid}-message` : undefined}
                  onclick={() => rebinding.listen(list, k)}
                  {onkeydown}
                  {onkeyup}>{rebinding.isListening(list, k) ? 'Press a key…' : label(key)}</button
                >
                <button
                  type="button"
                  class="remove"
                  aria-label="Remove {label(key)}"
                  title="Remove"
                  onclick={() => remove(list, k)}><X /></button
                >
              </span>
            {:else}
              <span class="none">No key</span>
            {/each}
            <button
              type="button"
              class="add"
              class:listening={rebinding.isListening(list, keys.length)}
              data-add={list}
              aria-describedby={rebinding.message ? `${uid}-message` : undefined}
              onclick={() => rebinding.listen(list, keys.length)}
              {onkeydown}
              {onkeyup}
              >{#if rebinding.isListening(list, keys.length)}Press a key…{:else}<Plus /> Add key{/if}</button
            >
          </span>
        </div>
      {/each}
    </div>
  {/if}
  {#if rebinding.message}
    {@const message = rebinding.message}
    <p class="message" id="{uid}-message" role="status">
      {message.text}{#if message.by}
        {@const by = message.by}{' '}<button type="button" class="holder" onclick={() => reveal(by)} onkeydown={escape}
          >{shortcuts[by].name}</button
        >.{/if}
    </p>
  {/if}
  {#if isChanged(shortcutKeys.value.keys, id)}
    <button type="button" class="button quiet reset" onclick={() => rebinding.reset()} onkeydown={escape}>Reset</button>
  {/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: var(--text-md);
  }
  /* A two-way Shortcut's Back and Forward take one width, so their keys line up. */
  .lists {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-2);
  }
  .lists.two-way {
    grid-template-columns: auto 1fr;
    column-gap: var(--space-3);
  }
  .list {
    display: contents;
  }
  .way {
    align-self: center;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .none {
    color: var(--text-muted);
  }
  /* A key to change: a button in a tint of the accent, with its x beside it. */
  .key,
  .add {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text);
  }
  .key button,
  .add {
    padding: var(--space-1) var(--space-2);
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .rebind {
    font-weight: 600;
    white-space: nowrap;
  }
  .key .remove {
    display: inline-flex;
    align-items: center;
    padding-inline: var(--space-1);
    border-left: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .add {
    align-items: center;
    gap: var(--space-1);
    border-style: dashed;
    background: none;
    color: var(--accent);
  }
  .listening {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 24%, transparent);
  }
  .listening .rebind,
  .add.listening {
    color: var(--text);
    font-weight: 400;
  }
  @media (hover: hover) {
    .key button:hover,
    .add:hover {
      background: color-mix(in srgb, var(--accent) 12%, transparent);
    }
    .key .remove:hover {
      color: var(--text);
    }
  }
  .message {
    margin: 0;
    color: var(--danger);
    font-size: var(--text-sm);
  }
  /* The Shortcut that has the key refused, as a link to it. */
  .holder {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
  }
  .reset {
    font-size: var(--text-sm);
  }
  /* A mouse Shortcut's modifiers, a toggle each, in a sentence: "Hold Ctrl Alt Shift and drag". */
  .held {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  /* The plain drag, as a key that can't be changed. */
  .fixed {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
  }
  .fixed kbd {
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    font: inherit;
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
</style>
