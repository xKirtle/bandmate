<script lang="ts">
  // One keyboard Shortcut's keys, in its fold in Settings' Shortcuts tab:
  // each a button that, clicked, waits for the next key pressed ("Press a
  // key…", Esc cancels), with an x to take it off, then Add key. A two-way
  // Shortcut's Back and Forward keys are listed on their own. A key that's
  // refused says why under them, naming the Shortcut that has it as a
  // button leading there, and it keeps waiting for another try. The message
  // goes on the next key taken, on Esc, or once focus leaves, unless it's
  // to that button; the fold unmounts this as it closes, which clears it too.
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { tick } from 'svelte';
  import { shortcutKeys } from './sharedShortcutKeys.svelte';
  import { keysLabel, platform, shortcuts, type Key } from './shortcuts';
  import {
    choose,
    isChanged,
    keyChosen,
    keysIn,
    listsOf,
    refusalMessage,
    removeKey,
    reset,
    type KeyList,
    type ShortcutId,
    type Slot,
  } from './shortcutKeys';

  let { id, onreveal }: { id: ShortcutId; onreveal: (id: ShortcutId) => void } = $props();

  const uid = $props.id();
  const on = platform();
  let root = $state<HTMLElement>();
  /** Where the next key pressed goes, while waiting for one. */
  let listening = $state<Slot | null>(null);
  let message = $state<{ text: string; by: ShortcutId | null } | null>(null);

  const lists = $derived(listsOf(id));
  const names: Record<KeyList, string> = { keys: 'Keys', back: 'Back', forward: 'Forward' };
  const label = (key: Key) => keysLabel([key], on);
  const isListening = (list: KeyList, index: number) => listening?.list === list && listening.index === index;

  function listen(list: KeyList, index: number) {
    // Space lets go of the button it's pressed on, clicking it again.
    if (isListening(list, index)) return;
    message = null;
    listening = { id, list, index };
  }

  function onkeydown(event: KeyboardEvent) {
    if (!listening || event.isComposing) return;
    // The key is for choosing, not for the button or the page.
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      listening = null;
      message = null;
      return;
    }
    const key = keyChosen(event);
    if (!key) return;
    const choice = choose(shortcutKeys.value, listening, key);
    if (!choice.ok) {
      message = refusalMessage(choice.refusal, on);
      return;
    }
    shortcutKeys.set(choice.keys);
    listening = null;
    message = null;
  }

  // Space would click the button again as it's let go.
  function onkeyup(event: KeyboardEvent) {
    if (listening) event.preventDefault();
  }

  // Focus leaving stops the waiting, and clears the message, unless it's to
  // the Shortcut the message names.
  function onfocusout(event: FocusEvent) {
    const to = event.relatedTarget;
    if (to instanceof Element && to.closest('.holder')) {
      listening = null;
      return;
    }
    listening = null;
    message = null;
  }

  async function remove(list: KeyList, index: number) {
    shortcutKeys.set(removeKey(shortcutKeys.value, { id, list, index }));
    message = null;
    // The key's buttons are gone: Add key takes the focus they had.
    await tick();
    root?.querySelector<HTMLElement>(`[data-add="${list}"]`)?.focus();
  }

  function resetKeys() {
    const choice = reset(shortcutKeys.value, id);
    if (choice.ok) {
      shortcutKeys.set(choice.keys);
      message = null;
    } else {
      message = refusalMessage(choice.refusal, on, true);
    }
  }

  // Esc clears a message from Reset or the Shortcut it names too, as it
  // does a refused key's while waiting (see onkeydown).
  function escape(event: KeyboardEvent) {
    if (event.key === 'Escape' && message && !listening) message = null;
  }

  function reveal(by: ShortcutId) {
    message = null;
    onreveal(by);
  }
</script>

<div class="editor" bind:this={root} {onfocusout}>
  <div class="lists" class:two-way={lists.length > 1}>
    {#each lists as list (list)}
      {@const keys = keysIn(shortcutKeys.value.keys, id, list)}
      <div class="list" role="group" aria-labelledby="{uid}-{list}">
        <span class="way" class:visually-hidden={lists.length === 1} id="{uid}-{list}">{names[list]}</span>
        <span class="keys">
          {#each keys as key, k (k)}
            <span class="key" class:listening={isListening(list, k)}>
              <button
                type="button"
                class="rebind"
                aria-label={isListening(list, k) ? 'Press a key' : `Change ${label(key)}`}
                aria-describedby={message ? `${uid}-message` : undefined}
                onclick={() => listen(list, k)}
                {onkeydown}
                {onkeyup}>{isListening(list, k) ? 'Press a key…' : label(key)}</button
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
            class:listening={isListening(list, keys.length)}
            data-add={list}
            aria-describedby={message ? `${uid}-message` : undefined}
            onclick={() => listen(list, keys.length)}
            {onkeydown}
            {onkeyup}
            >{#if isListening(list, keys.length)}Press a key…{:else}<Plus /> Add key{/if}</button
          >
        </span>
      </div>
    {/each}
  </div>
  {#if message}
    <p class="message" id="{uid}-message" role="status">
      {message.text}{#if message.by}
        {@const by = message.by}{' '}<button type="button" class="holder" onclick={() => reveal(by)} onkeydown={escape}
          >{shortcuts[by].name}</button
        >.{/if}
    </p>
  {/if}
  {#if isChanged(shortcutKeys.value.keys, id)}
    <button type="button" class="button quiet reset" onclick={resetKeys} onkeydown={escape}>Reset</button>
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
</style>
