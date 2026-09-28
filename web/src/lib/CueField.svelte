<script lang="ts">
  import { tick } from 'svelte';
  import { formatCue, nudgeCue, parseCue, playLabel } from './cues';

  // A Line's Cue time, shown as m:ss.s in the gutter beside it. Clicking it
  // lets the time be typed: Enter or leaving the field saves, Esc cancels,
  // and an empty field clears the Cue. Alt+↑/↓ nudges it by a tenth of a
  // second. A ✕ after it, shown while its Line is hovered or the keyboard is
  // in its slot, clears the Cue. With `pick`, as in Sync mode, clicking it
  // makes its Line the next to cue instead, and there's no ✕. A Cue out of
  // order is marked with a ⚠ and a warning colour, and says why on hover and
  // to screen readers.
  let {
    cue,
    label,
    save,
    next,
    play,
    current = false,
    hovered = false,
    pick,
    outOfOrder = null,
  }: {
    /** In seconds, or null without a Cue. */
    cue: number | null;
    /** Names the Line, e.g. "Line 3 of Chorus", for screen readers. */
    label: string;
    /** Saves the new Cue, or null to clear it. */
    save: (cue: number | null) => void;
    /** Given, Enter goes on to the next field; it answers whether there was one. */
    next?: () => boolean;
    /** Given, a ▶ before the time plays from the Cue. */
    play?: (to: number) => void;
    /** Whether playback is on the Line, so its ▶ isn't muted. */
    current?: boolean;
    /** Whether the pointer is over the Line, so its ✕ shows. */
    hovered?: boolean;
    /**
     * Given, as in Sync mode, clicking the time or ▶ makes the Line the next
     * to cue, rather than opening the time.
     */
    pick?: () => void;
    /** Given, the Cue is out of order, for this reason, e.g. "Later than Line 6 of Chorus (0:55.0)". */
    outOfOrder?: string | null;
  } = $props();

  let editing = $state(false);
  let text = $state('');
  let invalid = $state(false);
  let input = $state<HTMLInputElement>();
  let button = $state<HTMLButtonElement>();
  let clearButton = $state<HTMLButtonElement>();

  // Only a Cue can be out of order.
  const marked = $derived(cue !== null && !!outOfOrder);
  const outOfOrderNote = $derived(marked ? `. Out of order. ${outOfOrder}` : '');

  /** Opens the field to type a time. */
  export async function edit() {
    text = cue === null ? '' : formatCue(cue);
    invalid = false;
    editing = true;
    await tick();
    input?.select();
  }

  function commit() {
    if (!editing) return;
    const next = text.trim() === '' ? null : parseCue(text);
    if (next === null && text.trim() !== '') {
      invalid = true;
      return;
    }
    editing = false;
    // Typed as shown means unchanged, even if the Cue is finer than tenths.
    if (next === cue || (cue !== null && text.trim() === formatCue(cue))) return;
    save(next);
  }

  function cancel() {
    editing = false;
  }

  async function onkeydown(e: KeyboardEvent) {
    if (nudge(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      if (!editing && next?.()) return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else return;
    // Done from the keyboard, so keep the focus where it was.
    if (!editing) {
      await tick();
      button?.focus();
    }
  }

  /** Alt+↑/↓ saves the Cue, or the time typed, a tenth of a second later or earlier. */
  function nudge(e: KeyboardEvent): boolean {
    const by = e.altKey && !e.ctrlKey && !e.metaKey ? ({ ArrowUp: 1, ArrowDown: -1 } as const)[e.key] : undefined;
    if (by === undefined) return false;
    const from = editing ? (parseCue(text) ?? cue) : cue;
    if (from === null) return false;
    e.preventDefault();
    const to = nudgeCue(from, by);
    if (editing) {
      editing = false;
      tick().then(() => button?.focus());
    }
    if (to !== cue) save(to);
    return true;
  }

  // Clearing doesn't ask first: it can be undone. From the keyboard, the
  // focus goes on to the time, as the ✕ goes with the Cue.
  function clear() {
    const focused = document.activeElement === clearButton;
    save(null);
    if (focused) button?.focus();
  }

  // Leaving saves, unless what's typed isn't a time: then it's dropped
  // rather than kept open behind the user's back.
  function onblur() {
    if (editing && text.trim() !== '' && parseCue(text) === null) cancel();
    else commit();
  }
</script>

<span class="slot" class:current class:hovered>
  {#if play}
    {#if cue === null}
      <!-- Holds the ▶'s room, so the times still line up down the gutter. -->
      <span class="play" aria-hidden="true"></span>
    {:else}
      {@const at = cue}
      <!-- Clicked, it keeps focus where it was, so the cursor stays put and
           Space still plays and pauses. -->
      <button
        type="button"
        class="play"
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => {
          play(at);
          pick?.();
        }}
        aria-label={playLabel(label, at)}
        title="Play from here">▶</button
      >
    {/if}
  {/if}
  {#if editing}
    <input
      bind:this={input}
      bind:value={text}
      class="cue editing"
      class:invalid
      aria-label="Cue for {label}"
      aria-invalid={invalid}
      title={invalid
        ? 'Type a time like 45, 0:45, 0:45.25 or 1:02'
        : 'Enter saves, Esc cancels, empty clears, Alt+↑/↓ nudges'}
      placeholder="0:00.0"
      autocomplete="off"
      spellcheck="false"
      inputmode="decimal"
      enterkeyhint="done"
      oninput={() => (invalid = false)}
      {onkeydown}
      {onblur}
    />
  {:else}
    <button
      bind:this={button}
      type="button"
      class="cue"
      class:unset={cue === null}
      class:out-of-order={marked}
      onclick={pick ?? edit}
      onkeydown={nudge}
      aria-label={pick
        ? `Cue ${label} next${cue === null ? '' : `, cued at ${formatCue(cue)}${outOfOrderNote}`}`
        : cue === null
          ? `Set a Cue for ${label}`
          : `Cue for ${label}: ${formatCue(cue)}${outOfOrderNote}. Change it`}
      title={`${marked ? `Out of order. ${outOfOrder}. ` : ''}${
        pick
          ? 'Cue this next'
          : cue === null
            ? 'Set when this starts on the Timeline'
            : 'Change when this starts on the Timeline; Alt+↑/↓ nudges it'
      }`}
    >
      {#if marked}<span class="warning" aria-hidden="true">⚠</span>{/if}{cue === null ? '–:––.–' : formatCue(cue)}
    </button>
  {/if}
  {#if cue !== null && !pick && !editing}
    <!-- Clicked, it keeps focus where it was, as the ▶ does. -->
    <button
      bind:this={clearButton}
      type="button"
      class="clear"
      onpointerdown={(e) => e.preventDefault()}
      onclick={clear}
      aria-label="Clear the Cue of {label}"
      title="Clear this Cue">✕</button
    >
  {:else}
    <!-- Holds the ✕'s room, so the gutter never shifts. -->
    <span class="clear" aria-hidden="true"></span>
  {/if}
</span>

<style>
  .slot {
    display: inline-flex;
    align-items: center;
  }
  /* Kept as short as the Line beside it. */
  .cue {
    width: 5.5rem;
    min-height: 1.5rem;
    padding: 0 0.375rem;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    text-align: right;
    cursor: pointer;
  }
  .cue:hover,
  .cue:focus-visible,
  .cue.editing {
    border-color: var(--border);
    background: var(--surface-1);
    color: var(--text);
  }
  .cue.unset {
    opacity: 0.6;
  }
  .cue.out-of-order,
  .cue.out-of-order:hover,
  .cue.out-of-order:focus-visible {
    color: var(--warning);
  }
  /* Small, so the time beside it still fits the gutter. */
  .warning {
    margin-right: 0.125rem;
    font-size: 0.6875rem;
  }
  .cue.editing {
    cursor: text;
  }
  /* Muted, so a column of them down the gutter isn't noisy. */
  .play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 1.25rem;
    min-height: 1.5rem;
    padding: 0;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.625rem;
    opacity: 0.5;
    cursor: pointer;
  }
  .slot:hover .play,
  .play:focus-visible,
  .slot.current .play {
    color: var(--accent);
    opacity: 1;
  }
  /* Beside a ▶, the time gives up the room it takes. */
  .play + .cue {
    width: 4.25rem;
  }
  /* Out of sight, but still reachable by Tab, until its Line is hovered or
     the keyboard is in its slot. */
  .clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 1.25rem;
    min-height: 1.5rem;
    padding: 0;
    border: 0;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.6875rem;
    opacity: 0;
    pointer-events: none;
    cursor: pointer;
  }
  /* Only clickable once it shows, so a tap on nothing can't clear a Cue. */
  .slot:hover .clear,
  .slot.hovered .clear,
  .slot:focus-within .clear {
    opacity: 1;
    pointer-events: auto;
  }
  .clear:hover,
  .clear:focus-visible {
    color: var(--text);
  }
  .cue.invalid {
    border-color: var(--accent);
    outline-color: var(--accent);
  }
</style>
