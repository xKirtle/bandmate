<script lang="ts">
  // The search over the listed Shortcuts, the same in the shortcuts dialog
  // and Settings' Shortcuts tab: by name, what it does, where it works or
  // key (see searchGroups in shortcutList.ts).
  let {
    value = $bindable(''),
    input = $bindable(),
    onkeydown,
  }: {
    value?: string;
    input?: HTMLInputElement;
    onkeydown?: (event: KeyboardEvent) => void;
  } = $props();

  const uid = $props.id();
</script>

<search>
  <label class="visually-hidden" for="{uid}-search">Search Shortcuts by name, what they do or key</label>
  <input
    bind:this={input}
    bind:value
    id="{uid}-search"
    type="search"
    placeholder="Search by name, what it does or key"
    autocomplete="off"
    enterkeyhint="search"
    {onkeydown}
  />
</search>

<style>
  search {
    display: flex;
    flex: 1;
    flex-direction: column;
  }
</style>
