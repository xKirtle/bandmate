<script lang="ts">
  import type { Snippet } from 'svelte';
  import { isPicked, togglePick } from './listViews';

  // A filter's checklist, e.g. of producers or Tags: a box per choice, ticked
  // as picked, matched ignoring case, with what's beside each choice, if
  // anything, e.g. its ⋯.
  let {
    name,
    choices,
    picked,
    onpick,
    none,
    actions,
  }: {
    /** Names the checklist to screen readers, e.g. "Producer". */
    name: string;
    choices: readonly string[];
    picked: readonly string[];
    /** Hears the picks as one is ticked on or off. */
    onpick: (next: string[]) => void;
    /** Said in place of the checklist while there are no choices. */
    none: string;
    /** Beside a choice, e.g. its ⋯. */
    actions?: Snippet<[string]>;
  } = $props();
</script>

{#if choices.length === 0}
  <p class="muted none">{none}</p>
{:else}
  <fieldset class="choice-group checklist">
    <legend class="visually-hidden">{name}</legend>
    {#each choices as choice (choice)}
      <div class="row">
        <label class="choice-row">
          <input
            type="checkbox"
            checked={isPicked(picked, choice)}
            onchange={(e) => onpick(togglePick(picked, choice, e.currentTarget.checked))}
          />
          <span class="name" title={choice}>{choice}</span>
        </label>
        {@render actions?.(choice)}
      </div>
    {/each}
  </fieldset>
{/if}

<style>
  /* A long list scrolls, about six at a time. */
  .checklist {
    min-width: 0;
    max-height: calc(6 * var(--control));
    overflow-y: auto;
    padding-inline-end: var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .row .choice-row {
    flex: 1;
    min-width: 0;
  }
  /* A long choice is cut short, keeping what's beside it in reach on a phone. */
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    margin: var(--space-2) 0;
  }
</style>
