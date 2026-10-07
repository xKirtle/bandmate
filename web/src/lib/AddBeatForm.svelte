<script lang="ts">
  import AlreadyInLibrary from './AlreadyInLibrary.svelte';
  import type { Beat } from './api';
  import AudioPlayer from './AudioPlayer.svelte';
  import BeatFields from './BeatFields.svelte';
  import type { BeatToAdd } from './beatToAdd.svelte';
  import { formatDuration } from './time';

  // The form adding a Beat, in the Beat Library or the Beat Picker, for the
  // Beat being added, with what reading or adding it says: what it's doing,
  // and why it failed. Each place says what leaving it is called, what to do
  // with a Beat already in the Library from the same link, and with the Beat
  // once added.
  let {
    toAdd,
    library,
    already,
    submitLabel,
    leaveLabel,
    onAdded,
    onLeave,
    idPrefix,
    card = true,
  }: {
    toAdd: BeatToAdd;
    /** The Beat Library's Beats, or null while they load. */
    library: Beat[] | null;
    /** The already-in-the-Library warning's button, and what it does with that Beat. */
    already: { action: string; onUse: (beat: Beat) => void };
    submitLabel: string;
    leaveLabel: string;
    onAdded: (beat: Beat) => void;
    /** After the form's left, the Beat dropped. */
    onLeave?: () => void;
    idPrefix: string;
    /** A card on the page, headed "Add “file”"; off, it fills a dialog, such as the Beat Picker, headed by the file alone. */
    card?: boolean;
  } = $props();

  const alreadyAdded = $derived(toAdd.alreadyInLibrary(library));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const beat = await toAdd.add();
    if (beat) onAdded(beat);
  }

  function leave() {
    toAdd.leave();
    onLeave?.();
  }
</script>

{#if toAdd.adding}
  {@const adding = toAdd.adding}
  <form class="adding" class:card onsubmit={submit} aria-labelledby="{idPrefix}-heading">
    <!-- In a dialog, under the dialog's own title. -->
    <svelte:element this={card ? 'h2' : 'h3'} id="{idPrefix}-heading" class="heading">
      {card ? 'Add ' : ''}“{adding.file.name}”
      <span class="muted tabular">{formatDuration(adding.decoded.duration)}</span>
    </svelte:element>
    {#if adding.fetched}
      <AudioPlayer src={adding.fetched.previewUrl} duration={adding.decoded.duration} peaks={adding.decoded.peaks} />
    {/if}
    {#if alreadyAdded}
      {@const existing = alreadyAdded}
      <AlreadyInLibrary beat={existing} action={already.action} onOpen={() => already.onUse(existing)} />
    {/if}
    <BeatFields bind:draft={adding.draft} {idPrefix} />
    <div class="actions">
      <button type="submit" class="button primary" disabled={toAdd.busy !== null}>
        {alreadyAdded ? 'Add anyway' : submitLabel}
      </button>
      <button type="button" class="button" onclick={leave} disabled={toAdd.busy !== null}>{leaveLabel}</button>
    </div>
  </form>
{/if}
{#if toAdd.busy}
  <p class="muted" role="status">{toAdd.busy}</p>
{/if}
{#if toAdd.error}
  <p class="error" class:on-page={card} role="alert">{toAdd.error}</p>
{/if}

<style>
  .adding {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .adding.card {
    margin-bottom: var(--space-6);
    padding: var(--space-4);
  }
  .heading {
    margin: 0;
    font-size: var(--text-lg);
    overflow-wrap: anywhere;
  }
  h3.heading {
    font-weight: 600;
  }
  .heading span {
    font-weight: 400;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .error.on-page {
    margin-bottom: var(--space-4);
  }
</style>
