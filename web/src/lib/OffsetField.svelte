<script lang="ts">
  import { maxTypedOffset, typedOffset } from './calibration';

  // An Input's Latency Offset, typed in whole milliseconds, for one already
  // known, e.g. from another app or a Take that's clearly off: set with
  // Enter or Set, kept like a calibrated one. A value outside 0 to
  // maxTypedOffset ms, or not a whole number of them, is refused, and
  // nothing is kept. It shows the offset there is again whenever that
  // changes, e.g. calibrated in another tab.
  let {
    name,
    offset,
    onSet,
  }: {
    /** The Input's name, e.g. "Scarlett 2i2 · Input 1", to say whose offset it is. */
    name: string;
    /** Its Latency Offset now, in seconds, to start from, or null where it has none. */
    offset: number | null;
    /** Hears an offset typed, in seconds. */
    onSet: (offset: number) => void;
  } = $props();

  const id = $props.id();
  // What's typed, starting from the offset there is, and again whenever it changes.
  let typed = $derived(offset === null ? '' : String(Math.round(offset * 1000)));
  // What was refused, so it's refused only until what's typed changes.
  let refusedText = $state<string | null>(null);
  const refused = $derived(refusedText === typed);

  function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    const set = typedOffset(typed);
    refusedText = set === null ? typed : null;
    if (set !== null) onSet(set);
  }
</script>

<form class="offset-field" novalidate {onsubmit}>
  <div class="row">
    <input
      type="number"
      inputmode="numeric"
      min="0"
      max={maxTypedOffset}
      step="1"
      autocomplete="off"
      enterkeyhint="done"
      aria-label="Latency Offset of {name}, in ms"
      aria-invalid={refused ? 'true' : undefined}
      aria-describedby={refused ? `${id}-refused` : undefined}
      value={typed}
      oninput={(e) => (typed = e.currentTarget.value)}
    />
    <span class="unit" aria-hidden="true">ms</span>
    <button type="submit" class="button quiet" aria-label="Set the Latency Offset of {name}">Set</button>
  </div>
  {#if refused}
    <p class="error" id="{id}-refused" role="alert">Type a whole number of ms, from 0 to {maxTypedOffset}.</p>
  {/if}
</form>

<style>
  .offset-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  input {
    /* Room for "500" and the browser's spinner. */
    width: 6rem;
  }
  input[aria-invalid='true'] {
    border-color: var(--danger);
    box-shadow: var(--invalid-outline);
  }
  .unit {
    color: var(--text-muted);
    font-size: var(--text-md);
  }
  .error {
    font-size: var(--text-sm);
  }
</style>
