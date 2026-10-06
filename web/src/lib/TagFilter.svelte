<script lang="ts">
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ActionsMenu from './ActionsMenu.svelte';
  import type { Tag } from './api';
  import FilterButton from './FilterButton.svelte';
  import { isPicked, matchingChoices, pickChoices, tagFilterLabel, togglePick } from './listViews';

  // The Songs page's Tags filter: a checklist of every Tag, with a box to
  // find one, where each Tag can also be renamed or deleted.
  let {
    picked,
    tags,
    onpick,
    onrename,
    ondelete,
  }: {
    /** The names of the Tags picked. */
    picked: string[];
    /** Every Tag. */
    tags: readonly Tag[];
    /** Hears the Tags picked as they change. */
    onpick: (next: string[]) => void;
    onrename: (tag: Tag) => void;
    ondelete: (tag: Tag) => void;
  } = $props();

  const id = $props.id();
  let find = $state('');
  // Those picked that no Song carries now stay, so they can be unticked.
  const choices = $derived(
    matchingChoices(
      pickChoices(
        tags.map((t) => t.name),
        picked,
      ),
      find,
    ),
  );
  const byName = $derived(new Map(tags.map((t) => [t.name, t])));
</script>

<FilterButton name="Tags" label={tagFilterLabel(picked)} picked={picked.length > 0}>
  {#if tags.length === 0 && picked.length === 0}
    <p class="muted none">No Song has a Tag.</p>
  {:else}
    <label class="visually-hidden" for="{id}-find">Find a Tag</label>
    <input
      id="{id}-find"
      class="find"
      type="search"
      bind:value={find}
      placeholder="Find a Tag"
      autocomplete="off"
      enterkeyhint="search"
    />
    {#if choices.length === 0}
      <p class="muted none">No Tag matches.</p>
    {:else}
      <fieldset class="choice-group checklist">
        <legend class="visually-hidden">Tags</legend>
        {#each choices as choice (choice)}
          {@const tag = byName.get(choice)}
          <div class="row">
            <label class="choice-row">
              <input
                type="checkbox"
                checked={isPicked(picked, choice)}
                onchange={(e) => onpick(togglePick(picked, choice, e.currentTarget.checked))}
              />
              <span class="name" title={choice}>{choice}</span>
            </label>
            {#if tag}
              <ActionsMenu
                label="More actions for the Tag {tag.name}"
                entries={[
                  { icon: Pencil, label: 'Rename…', run: () => onrename(tag) },
                  { icon: Trash2, label: 'Delete…', run: () => ondelete(tag) },
                ]}
              />
            {/if}
          </div>
        {/each}
      </fieldset>
    {/if}
  {/if}
</FilterButton>

<style>
  .find {
    width: 100%;
    margin: var(--space-1) 0 var(--space-2);
  }
  /* A long list of Tags scrolls, about six at a time. */
  .checklist {
    min-width: 0;
    max-height: calc(6 * var(--control));
    overflow-y: auto;
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
  /* A long name is cut short, keeping its ⋯ in reach on a phone. */
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
