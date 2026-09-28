<script lang="ts">
  import { tick } from 'svelte';
  import { formatCue, nudgeCue, parseCue, playLabel } from './cues';

  // A Cue's time, shown as m:ss.s. Clicking it lets the time be typed:
  // Enter or leaving the field saves, Esc cancels, and an empty field clears
  // the Cue. Alt+↑/↓ nudges it by a tenth of a second. In Sync mode,
  // clicking it makes what it's for the next to cue instead.
  let {
    cue,
    label,
    save,
    next,
    gutter = false,
    play,
    current = false,
    pick,
  }: {
    /** In seconds, or null without a Cue. */
    cue: number | null;
    /** What the Cue is for, e.g. "Chorus", for screen readers. */
    label: string;
    /** Saves the new Cue, or null to clear it. */
    save: (cue: number | null) => void;
    /** Given, Enter goes on to the next field; it answers whether there was one. */
    next?: () => boolean;
    /** Beside a Line, so kept as short as the Line. */
    gutter?: boolean;
    /** Given, a ▶ before the time seeks the Timeline to the Cue. */
    play?: (to: number) => void;
    /** Whether playback is on what the Cue is for, so its ▶ isn't muted. */
    current?: boolean;
    /** Given, as in Sync mode, clicking the time or ▶ makes what the Cue is for the next to cue; the time isn't opened. */
    pick?: () => void;
  } = $props();

  let editing = $state(false);
  let text = $state('');
  let invalid = $state(false);
  let input = $state<HTMLInputElement>();
  let button = $state<HTMLButtonElement>();

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

  // Leaving saves, unless what's typed isn't a time: then it's dropped
  // rather than kept open behind the user's back.
  function onblur() {
    if (editing && text.trim() !== '' && parseCue(text) === null) cancel();
    else commit();
  }
</script>

<span class="slot" class:current>
  {#if play}
    {#if cue === null}
      <!-- Holds the ▶'s room, so the times still line up down the gutter. -->
      <span class="play" class:gutter aria-hidden="true"></span>
    {:else}
      {@const at = cue}
      <!-- Clicked, it keeps focus where it was, so the cursor stays put and
           Space still plays and pauses. -->
      <button
        type="button"
        class="play"
        class:gutter
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
      class:gutter
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
      class:gutter
      class:unset={cue === null}
      onclick={pick ?? edit}
      onkeydown={nudge}
      aria-label={pick
        ? `Cue ${label} next${cue === null ? '' : `, cued at ${formatCue(cue)}`}`
        : cue === null
          ? `Set a Cue for ${label}`
          : `Cue for ${label}: ${formatCue(cue)}. Change it`}
      title={pick
        ? 'Cue this next'
        : cue === null
          ? 'Set when this starts on the Timeline'
          : 'Change when this starts on the Timeline; Alt+↑/↓ nudges it'}
    >
      {cue === null ? '–:––.–' : formatCue(cue)}
    </button>
  {/if}
</span>

<style>
  .slot {
    display: inline-flex;
    align-items: center;
  }
  .cue {
    width: 5.5rem;
    min-height: 2rem;
    padding: 0.125rem 0.375rem;
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
  .cue.gutter {
    min-height: 1.5rem;
    padding-block: 0;
  }
  .cue.unset {
    opacity: 0.6;
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
    min-height: 2rem;
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
  .play.gutter {
    min-height: 1.5rem;
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
  .cue.invalid {
    border-color: var(--accent);
    outline-color: var(--accent);
  }
</style>
