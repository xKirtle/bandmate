<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import Combobox from './Combobox.svelte';

  // Changes a Song's Tags: each one carried, with a button taking it off,
  // then a field to add one, suggesting the Tags already in use. A name no
  // Tag has makes one; the server trims names and matches them ignoring case.
  let {
    id,
    tags,
    known,
    labelledby,
    autofocus = false,
    onchange,
  }: {
    id: string;
    /** The Tags the Song carries. */
    tags: readonly string[];
    /** Every Tag's name, to suggest. */
    known: readonly string[];
    /** The id of what names the field. */
    labelledby?: string;
    /** Whether the field takes focus as it appears, e.g. as a dialog opens. */
    autofocus?: boolean;
    /** Hears the Song's whole list of Tags, once one is added or taken off. */
    onchange: (tags: string[]) => void;
  } = $props();

  let typed = $state('');
  const carried = $derived(new Set(tags.map((t) => t.toLowerCase())));
  // The Tags it doesn't carry yet.
  const suggestions = $derived(known.filter((name) => !carried.has(name.toLowerCase())));

  // A name it carries already, ignoring case, adds nothing; one a Tag has
  // takes that Tag's spelling.
  function add(text: string) {
    const name = text.trim();
    typed = '';
    if (!name || carried.has(name.toLowerCase())) return;
    const existing = known.find((k) => k.toLowerCase() === name.toLowerCase());
    onchange([...tags, existing ?? name]);
  }

  function remove(name: string) {
    onchange(tags.filter((t) => t !== name));
  }

  // Enter adds what's typed, unless a suggestion is highlighted: the
  // combobox picks that.
  function onkeydown(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (e.key !== 'Enter' || e.currentTarget.getAttribute('aria-activedescendant')) return;
    e.preventDefault();
    add(typed);
  }
</script>

<div class="tags-field">
  {#if tags.length > 0}
    <ul class="carried" aria-label="Tags">
      {#each tags as name (name)}
        <li class="badge tag">
          <span class="name">{name}</span>
          <button
            type="button"
            class="remove"
            aria-label="Take off “{name}”"
            title="Take off"
            onclick={() => remove(name)}><X /></button
          >
        </li>
      {/each}
    </ul>
  {/if}
  <div class="add">
    <Combobox
      {id}
      bind:value={typed}
      options={suggestions}
      saved=""
      onpick={add}
      onchange={() => add(typed)}
      {onkeydown}
      aria-labelledby={labelledby}
      {autofocus}
      autocomplete="off"
      enterkeyhint="done"
      placeholder="Add a Tag"
    />
  </div>
</div>

<style>
  .tags-field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .carried {
    display: contents;
  }
  /* A Tag as TagChips shows it, a step larger to tap its ×, at the end. */
  .tag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    padding-inline-end: var(--space-1);
    font-size: var(--text-sm);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Bigger to tap than it looks, without making the Tag taller. */
  .remove {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    margin-block: calc(-1 * var(--space-1));
    padding: var(--space-1);
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .remove:hover {
    color: var(--text);
  }
  .add {
    flex: 1 1 8rem;
    min-width: 8rem;
  }
  .add :global(input) {
    width: 100%;
  }
</style>
