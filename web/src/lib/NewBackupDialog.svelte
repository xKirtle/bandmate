<script lang="ts">
  import { api, type Backup, type Beat, type SongSummary } from './api';
  import { backupName, backupSize, beatCount, beatsBrought, broughtNote, newBackup } from './backups';
  import Dialog from './Dialog.svelte';
  import PickList from './PickList.svelte';

  // "New Backup": ticks what goes in, Songs and Beats (some or all of each),
  // together or not, then makes the Backup in the same modal dialog, which
  // holds focus until it's made: it can't be closed meanwhile, by a click
  // outside, Esc, or a button.
  let {
    onMade,
    onClose,
  }: {
    /** Hears the Backup made, as soon as it is. */
    onMade: (backup: Backup) => void;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let phase = $state<'picking' | 'making' | 'made'>('picking');
  let songs = $state<SongSummary[] | null>(null);
  /** The Beat Library's Beats. */
  let beats = $state<Beat[] | null>(null);
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  /** Whether Songs are ticked; unticking them keeps the picks for when they're ticked again. */
  let songsTicked = $state(false);
  let picked = $state<Set<number>>(new Set());
  /** Whether the Beat Library is ticked; unticking it keeps the picks for when it's ticked again. */
  let beatsTicked = $state(false);
  let pickedBeats = $state<Set<number>>(new Set());
  let made = $state<Backup | null>(null);

  const songIds = $derived(songs?.map((s) => s.id) ?? []);
  /** The Songs that go in, by id. */
  const songsIn = $derived(songsTicked ? songIds.filter((id) => picked.has(id)) : []);
  /** The Beats the Songs that go in bring, shown ticked and locked. */
  const brought = $derived(beatsBrought(songsIn, beats ?? []));
  /** The Backup to make, with its name, or what's missing before one can be made. */
  const toMake = $derived(
    newBackup({ songsTicked, picked, beatsTicked, pickedBeats }, { songIds, beats: beats ?? [] }),
  );
  const name = $derived('name' in toMake ? toMake.name : '');

  Promise.all([api.listSongs(), api.listBeats()]).then(
    ([songList, beatList]) => {
      songs = [...songList].sort((a, b) => a.title.localeCompare(b.title));
      beats = [...beatList].sort((a, b) => a.title.localeCompare(b.title));
      // Open on Everything there is, to back up in one click.
      songsTicked = songs.length > 0;
      picked = new Set(songs.map((s) => s.id));
      beatsTicked = beats.length > 0;
      pickedBeats = new Set(beats.map((b) => b.id));
    },
    (e: Error) => (loadError = e.message),
  );

  async function make() {
    if ('missing' in toMake) return;
    const { contents } = toMake;
    phase = 'making';
    error = null;
    try {
      made = await api.makeBackup(contents);
      onMade(made);
      phase = 'made';
    } catch (e) {
      error = `Couldn't make the Backup (${(e as Error).message})`;
      phase = 'picking';
    }
  }

  function oncancel(e: Event) {
    if (phase === 'making') e.preventDefault();
  }
</script>

<Dialog
  bind:dialog
  title="New Backup"
  closeButton={phase === 'making' ? 'hidden' : 'shown'}
  dismissible={() => phase !== 'making'}
  {oncancel}
  onclose={onClose}
>
  {#if phase === 'picking'}
    {#if loadError}
      <p class="problem" role="alert">{loadError}</p>
    {:else if songs === null || beats === null}
      <p class="muted">Loading…</p>
    {:else if songs.length === 0 && beats.length === 0}
      <p>There are no Songs or Beats to back up yet.</p>
    {:else}
      <fieldset class="choice-group">
        <legend>What goes in</legend>
        <label class="choice-row">
          <input
            type="checkbox"
            bind:checked={songsTicked}
            disabled={songs.length === 0}
            aria-describedby="backup-songs-note"
          />
          <span>Songs</span>
        </label>
        <div class="choice-under">
          <p id="backup-songs-note" class="muted">
            Each Song goes in whole, from its Lyric Sheet to its Timeline, Cover and Masters, with the Beats its Clips
            use.
          </p>
          {#if songsTicked}
            <PickList items={songs} bind:picked label="Songs to back up" />
            {#if !beatsTicked && songsIn.length > 0}
              <p class="muted">{broughtNote(songsIn.length, brought.size)}</p>
            {/if}
          {/if}
        </div>
        <label class="choice-row">
          <input
            type="checkbox"
            bind:checked={beatsTicked}
            disabled={beats.length === 0}
            aria-describedby="backup-beat-library-note"
          />
          <span>Beat Library <span class="muted">· {beatCount(beats.length)}</span></span>
        </label>
        <div class="choice-under">
          <p id="backup-beat-library-note" class="muted">Each Beat goes in with its credit.</p>
          {#if beatsTicked}
            <PickList
              items={beats}
              bind:picked={pickedBeats}
              label="Beats to back up"
              detail={(b) => b.producer}
              locked={brought}
              lockedNote="used by a picked Song"
            />
          {/if}
        </div>
      </fieldset>
      {#if 'missing' in toMake}
        <p id="backup-missing" class="muted">{toMake.missing}</p>
      {/if}
    {/if}
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
  {:else if phase === 'making'}
    <p role="status" aria-live="polite">Backing up {name}…</p>
    <progress aria-label="Making the Backup"></progress>
    <p class="muted">Don't leave or close this page until it's done.</p>
  {:else if made}
    <p role="status">Backed up as “{backupName(made)}”, {backupSize(made.size)}.</p>
  {/if}

  <div class="actions">
    {#if phase === 'picking'}
      {#if songs && beats && (songs.length > 0 || beats.length > 0)}
        <button
          type="button"
          class="button primary"
          onclick={make}
          disabled={'missing' in toMake}
          aria-describedby={'missing' in toMake ? 'backup-missing' : undefined}
        >
          Back up {name}
        </button>
      {/if}
      <button type="button" class="button" onclick={() => dialog?.close()}>Cancel</button>
    {:else if phase === 'made' && made}
      <a class="button primary" href={api.backupDownloadUrl(made.id)} download>Download</a>
      <button type="button" class="button" onclick={() => dialog?.close()}>Done</button>
    {/if}
  </div>
</Dialog>

<style>
  p {
    margin: 0;
  }
  progress {
    width: 100%;
    accent-color: var(--accent);
  }
  .problem {
    color: var(--danger);
  }
  .muted {
    font-size: var(--text-md);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
