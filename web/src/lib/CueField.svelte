<script lang="ts">
  import { tick } from 'svelte';
  import { formatCue, parseCue } from './cues';

  // A Cue's time, shown as m:ss.s. Clicking it lets the time be typed:
  // Enter or leaving the field saves, Esc cancels, and an empty field clears
  // the Cue.
  let {
    cue,
    label,
    save,
  }: {
    /** In seconds, or null without a Cue. */
    cue: number | null;
    /** What the Cue is for, e.g. "Chorus", for screen readers. */
    label: string;
    /** Saves the new Cue, or null to clear it. */
    save: (cue: number | null) => void;
  } = $props();

  let editing = $state(false);
  let text = $state('');
  let invalid = $state(false);
  let input = $state<HTMLInputElement>();
  let button = $state<HTMLButtonElement>();

  async function start() {
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
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
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

  // Leaving saves, unless what's typed isn't a time: then it's dropped
  // rather than kept open behind the user's back.
  function onblur() {
    if (editing && text.trim() !== '' && parseCue(text) === null) cancel();
    else commit();
  }
</script>

{#if editing}
  <input
    bind:this={input}
    bind:value={text}
    class="cue editing"
    class:invalid
    aria-label="Cue for {label}"
    aria-invalid={invalid}
    title={invalid ? 'Type a time like 45, 0:45, 0:45.25 or 1:02' : 'Enter saves, Esc cancels, empty clears'}
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
    onclick={start}
    aria-label={cue === null ? `Set a Cue for ${label}` : `Cue for ${label}: ${formatCue(cue)}. Change it`}
    title={cue === null ? 'Set when this starts on the Timeline' : 'Change when this starts on the Timeline'}
  >
    {cue === null ? '–:––.–' : formatCue(cue)}
  </button>
{/if}

<style>
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
  .cue.unset {
    opacity: 0.6;
  }
  .cue.editing {
    cursor: text;
  }
  .cue.invalid {
    border-color: var(--accent);
    outline-color: var(--accent);
  }
</style>
