<script lang="ts">
  import { commonKeys } from './api';
  import type { BeatDraft } from './beatDraft';

  // The inputs for a Beat's details, bound to a draft the caller saves.
  let { draft = $bindable(), idPrefix }: { draft: BeatDraft; idPrefix: string } = $props();
</script>

<div class="fields">
  <label class="wide">
    Title
    <input bind:value={draft.title} required autocomplete="off" enterkeyhint="next" />
  </label>
  <label>
    Producer
    <input bind:value={draft.producer} autocomplete="off" enterkeyhint="next" placeholder="—" />
  </label>
  <label>
    Source link
    <input
      bind:value={draft.sourceLink}
      type="url"
      inputmode="url"
      autocomplete="off"
      enterkeyhint="next"
      placeholder="https://…"
    />
  </label>
  <label>
    BPM
    <input bind:value={draft.bpm} inputmode="numeric" autocomplete="off" enterkeyhint="next" placeholder="—" />
  </label>
  <label>
    Key
    <input
      bind:value={draft.key}
      list="{idPrefix}-keys"
      autocomplete="off"
      autocapitalize="characters"
      enterkeyhint="next"
      placeholder="—"
    />
  </label>
  <label class="wide">
    Notes
    <textarea bind:value={draft.notes} rows="3" placeholder="License, where it's from…"></textarea>
  </label>
</div>

<datalist id="{idPrefix}-keys">
  {#each commonKeys as k (k)}<option value={k}></option>{/each}
</datalist>

<style>
  .fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.75rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  input,
  textarea {
    color: var(--text);
    font-weight: 400;
  }
  .wide {
    grid-column: 1 / -1;
  }

  @media (min-width: 36rem) {
    .fields {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
