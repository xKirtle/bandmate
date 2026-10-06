<script lang="ts">
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ActionsMenu from './ActionsMenu.svelte';
  import type { Tag } from './api';
  import Checklist from './Checklist.svelte';
  import FilterButton from './FilterButton.svelte';
  import { isPicked, matchingChoices, pickChoices, tagFilterLabel } from './listViews';

  // The Songs page's Tags filter: a checklist of every Tag, with a box to
  // find one, where each Tag can also be renamed or deleted.
  let {
    picked,
    tags,
    onpick,
    onrename,
    ondelete,
  }: {
    /** The names of the Tags picked, as the URL has them. */
    picked: string[];
    /** Every Tag. */
    tags: readonly Tag[];
    /** Hears the Tags picked as they change. */
    onpick: (next: string[]) => void;
    /** Hears that a Tag is to be renamed, from its ⋯. */
    onrename: (tag: Tag) => void;
    /** Hears that a Tag is to be deleted, from its ⋯. */
    ondelete: (tag: Tag) => void;
  } = $props();

  const id = $props.id();
  let find = $state('');
  // Those picked that no Song carries now stay, so they can be unticked.
  const names = $derived(
    pickChoices(
      tags.map((t) => t.name),
      picked,
    ),
  );
  const choices = $derived(matchingChoices(names, find));
  const byName = $derived(new Map(tags.map((t) => [t.name, t])));
  // The button names each Tag picked as the Tag itself is named, whatever
  // case the URL has it in.
  const label = $derived(tagFilterLabel(names.filter((n) => isPicked(picked, n))));
</script>

<FilterButton name="Tags" {label} picked={picked.length > 0}>
  {#if names.length === 0}
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
    <Checklist name="Tags" {choices} {picked} {onpick} none="No Tag matches.">
      {#snippet actions(choice)}
        {@const tag = byName.get(choice)}
        {#if tag}
          <ActionsMenu
            label="More actions for the Tag {tag.name}"
            entries={[
              { icon: Pencil, label: 'Rename…', run: () => onrename(tag) },
              { icon: Trash2, label: 'Delete…', run: () => ondelete(tag) },
            ]}
          />
        {/if}
      {/snippet}
    </Checklist>
  {/if}
</FilterButton>

<style>
  .find {
    width: 100%;
    margin: var(--space-1) 0 var(--space-2);
  }
  .none {
    margin: var(--space-2) 0;
  }
</style>
