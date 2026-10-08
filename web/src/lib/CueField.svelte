<script lang="ts">
  import Play from '@lucide/svelte/icons/play';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import { onDestroy, tick, untrack } from 'svelte';
  import { formatCue, nudgeCue, parseCue, playLabel, typedCue } from './cues';
  import { cueNudge, cueNudgeHint } from './cueKeys';
  import { keyHints } from './keyHints';
  import type { Typing } from './saves.svelte';
  import { TypedField } from './typedField.svelte';

  // A Line's Cue time, shown as m:ss.s in the gutter beside it. Clicking it
  // lets the time be typed: Enter or leaving the field saves, Esc cancels,
  // and an empty field clears the Cue. Alt+↑/↓ nudges it by a tenth of a
  // second, but not in Sync mode, which only cues. A ✕ after it, shown while
  // its Line is hovered or the keyboard is in its slot, clears the Cue. With
  // `pick`, as in Sync mode, clicking it makes its Line the next to cue
  // instead, and there's no ✕. A Cue out of order is marked with a ⚠ and a
  // warning colour, and says why on hover and to screen readers.
  let {
    cue,
    label,
    save,
    next,
    play,
    current = false,
    hovered = false,
    pick,
    syncing = false,
    outOfOrder = null,
    typing,
  }: {
    /** In seconds, or null without a Cue. */
    cue: number | null;
    /** Names the Line, e.g. "Line 3 of Chorus", for screen readers. */
    label: string;
    /** Saves the new Cue, or null to clear it. */
    save: (cue: number | null) => void;
    /** Puts the time being typed on Saves' list of edits being typed, until the function returned is called. */
    typing: (entry: Typing) => () => void;
    /** Given, Enter goes on to the next field; it answers whether there was one. */
    next?: () => boolean;
    /** Given, a ▶ before the time plays from the Cue. */
    play?: (to: number) => void;
    /** Whether playback is on the Line, so its ▶ isn't muted. */
    current?: boolean;
    /** Whether the pointer is over the Line, so its ✕ shows. */
    hovered?: boolean;
    /**
     * Given, as in Sync mode, clicking the time makes the Line the next to
     * cue, rather than opening the time. The ▶ only plays, leaving the Line
     * up next where it is.
     */
    pick?: () => void;
    /** Whether Sync mode is on, where Alt+↑/↓ doesn't nudge the Cue, even a Chord Line's, which isn't picked. */
    syncing?: boolean;
    /** Given, the Cue is out of order, for this reason, e.g. "Later than Line 6 of Chorus (0:55.0)". */
    outOfOrder?: string | null;
  } = $props();

  // The time as typed, by the rules of a field typed in place: an empty
  // field clears the Cue, and one that isn't a time stays open, marked.
  // It's saved as the field goes, e.g. on leaving the page.
  const field = new TypedField<number | null>({
    saved: () => cue,
    format: (at) => (at === null ? '' : formatCue(at)),
    parse: (typed) => typedCue(typed, cue),
    commit: (at) => save(at),
    typing: untrack(() => typing),
  });
  onDestroy(field.destroy);

  let editing = $state(false);
  const invalid = $derived(field.message !== null);
  let input = $state<HTMLInputElement>();
  let button = $state<HTMLButtonElement>();
  let clearButton = $state<HTMLButtonElement>();

  // The keys that nudge the Cue, later then earlier, named as this platform
  // does, but only with a keyboard and mouse, and not in Sync mode.
  const hints = keyHints();
  const nudgeHint = $derived(cueNudgeHint(hints, syncing));

  // Said first on hover, and after the time to screen readers.
  const outOfOrderNote = $derived(outOfOrder ? `Out of order. ${outOfOrder}.` : '');

  /** Opens the field to type a time. */
  export async function edit() {
    field.cancel();
    editing = true;
    await tick();
    input?.select();
  }

  function commit() {
    if (editing && field.commit()) editing = false;
  }

  function cancel() {
    field.cancel();
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

  /** Alt+↑/↓, or as the list has it, saves the Cue, or the time typed, a tenth of a second later or earlier, but not in Sync mode. */
  function nudge(e: KeyboardEvent): boolean {
    const by = cueNudge(e, syncing);
    if (by === null) return false;
    const from = editing ? (parseCue(field.shown) ?? cue) : cue;
    if (from === null) return false;
    e.preventDefault();
    const to = nudgeCue(from, by);
    if (editing) {
      cancel();
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
    if (editing && !field.commit()) field.cancel();
    editing = false;
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
        onclick={() => play(at)}
        aria-label={playLabel(label, at)}
        title="Play from here"><Play /></button
      >
    {/if}
  {/if}
  {#if editing}
    <input
      bind:this={input}
      bind:value={field.shown}
      class="cue editing"
      class:invalid
      aria-label="Cue for {label}"
      aria-invalid={invalid}
      aria-keyshortcuts={nudgeHint.aria}
      title={field.message ??
        `Enter saves, Esc cancels, empty clears${nudgeHint.label ? `, ${nudgeHint.label} nudges` : ''}`}
      placeholder="0:00.0"
      autocomplete="off"
      spellcheck="false"
      inputmode="decimal"
      enterkeyhint="done"
      {onkeydown}
      {onblur}
    />
  {:else}
    <button
      bind:this={button}
      type="button"
      class="cue"
      class:unset={cue === null}
      class:out-of-order={outOfOrder}
      onclick={pick ?? edit}
      onkeydown={nudge}
      aria-keyshortcuts={nudgeHint.aria}
      aria-label={pick
        ? `Cue ${label} next${cue === null ? '' : `, cued at ${formatCue(cue)}${outOfOrder ? `. ${outOfOrderNote}` : ''}`}`
        : cue === null
          ? `Set a Cue for ${label}`
          : `Cue for ${label}: ${formatCue(cue)}.${outOfOrder ? ` ${outOfOrderNote}` : ''} Change it`}
      title={`${outOfOrder ? `${outOfOrderNote} ` : ''}${
        pick
          ? 'Cue this next'
          : cue === null
            ? 'Set when this starts on the Timeline'
            : `Change when this starts on the Timeline${nudgeHint.label ? `; ${nudgeHint.label} nudges it` : ''}`
      }`}
    >
      {#if outOfOrder}<span class="warning" aria-hidden="true"><TriangleAlert /></span>{/if}{cue === null
        ? '–:––.–'
        : formatCue(cue)}
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
      title="Clear this Cue"><X /></button
    >
  {:else}
    <!-- Holds the ✕'s room, so the gutter never shifts. -->
    <span class="clear" aria-hidden="true"></span>
  {/if}
</span>

<style>
  /* As wide as every other slot, whatever it shows, so the times line up
     down the gutter. */
  .slot {
    display: inline-flex;
    align-items: center;
    width: var(--cue-slot);
  }
  /* Kept as short as the Line beside it, on one line: it takes what the ▶
     and ✕ leave, whether it shows the time or the field to type one. */
  .cue {
    flex: 1;
    min-width: 0;
    min-height: 1.5rem;
    padding: 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
    cursor: pointer;
  }
  .cue:hover,
  :global(:root:not([data-pointer-focus])) .cue:focus-visible,
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
    margin-right: var(--space-1);
    font-size: var(--text-xs);
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
    width: var(--cue-button);
    min-height: 1.5rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-xs);
    opacity: 0.5;
    cursor: pointer;
  }
  /* Solid, so it reads at this size. */
  .play :global(.lucide-icon) {
    fill: currentColor;
  }
  .slot:hover .play,
  .play:focus-visible,
  .slot.current .play {
    color: var(--accent);
    opacity: 1;
  }
  /* Out of sight, but still reachable by Tab, until its Line is hovered or
     the keyboard is in its slot. */
  .clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--cue-button);
    min-height: 1.5rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-xs);
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
