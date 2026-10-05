<script lang="ts">
  import {
    api,
    type Backup,
    type BackupBeat,
    type BackupPresence,
    type BackupPresent,
    type BackupRestored,
    type BackupSong,
  } from './api';
  import {
    backupName,
    beatCount,
    beatsBrought,
    broughtNote,
    replaceConfirmation,
    restoredName,
    restorePicks,
  } from './backups';
  import Dialog from './Dialog.svelte';
  import PickList from './PickList.svelte';

  // "Restore": ticks what comes back from a Backup, Songs and Beats (some or
  // all of each), as "New Backup" ticks what goes in, then restores them,
  // each Song with the Beats its Clips use, in the same modal dialog, which
  // holds focus until they're back: it can't be closed meanwhile, by a
  // click outside, Esc, or a button. Where
  // Songs or Beats picked are already in Bandmate (the same ones, not just
  // the same titles), a step lists them, each to replace or keep both, keep
  // both by default, which adds the restored one alongside as
  // "Title (restored)". Replacing any asks for a confirmation naming them
  // first. Nothing the Backup doesn't hold is ever deleted.
  let {
    backup,
    onClose,
  }: {
    backup: Backup;
    onClose: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let phase = $state<'picking' | 'checking' | 'deciding' | 'restoring' | 'restored'>('picking');
  let songs = $state<BackupSong[] | null>(null);
  /** The Beats the Backup holds, its Beat Library or chosen Beats. */
  let beats = $state<BackupBeat[] | null>(null);
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  /** Whether Songs are ticked; unticking them keeps the picks for when they're ticked again. */
  let songsTicked = $state(false);
  let picked = $state<Set<number>>(new Set());
  /** Whether the Beat Library is ticked; unticking it keeps the picks for when it's ticked again. */
  let beatsTicked = $state(false);
  let pickedBeats = $state<Set<number>>(new Set());
  // What's already in Bandmate of what's picked, and which of it to
  // replace, by kind and id in the Backup.
  let present = $state<BackupPresence>({ songs: [], beats: [] });
  let replacing = $state<{ songs: Set<number>; beats: Set<number> }>({ songs: new Set(), beats: new Set() });
  let restored = $state<BackupRestored>({ songs: [], beats: 0 });
  const replacingAny = $derived(replacing.songs.size + replacing.beats.size > 0);
  const songIds = $derived(songs?.map((s) => s.id) ?? []);
  /** The Songs that come back, by id. */
  const songsIn = $derived(songsTicked ? songIds.filter((id) => picked.has(id)) : []);
  /** The Beats the Songs that come back bring, shown ticked and locked. */
  const brought = $derived(beatsBrought(songsIn, beats ?? []));
  /** What to restore, with its name, or what's missing before it can be. */
  const toRestore = $derived(
    restorePicks(
      { songsTicked, picked, beatsTicked, pickedBeats },
      { songIds, beats: beats ?? [], beatLibrary: backup.beatLibrary },
    ),
  );
  const pickedName = $derived('name' in toRestore ? toRestore.name : '');

  // svelte-ignore state_referenced_locally
  Promise.all([api.backupSongs(backup.id), api.backupBeats(backup.id)]).then(
    ([songList, beatList]) => {
      songs = songList;
      beats = beatList;
      // Open on everything the Backup holds, to restore in one click.
      songsTicked = songs.length > 0;
      picked = new Set(songs.map((s) => s.id));
      beatsTicked = beats.length > 0;
      pickedBeats = new Set(beats.map((b) => b.id));
    },
    (e: Error) => (loadError = e.message),
  );

  // Asks which of the Songs picked, of their Beats, and of the Beats picked
  // are already in Bandmate: if any are, the user says which to replace
  // first.
  async function check() {
    if ('missing' in toRestore) return;
    const { picks } = toRestore;
    phase = 'checking';
    error = null;
    try {
      present = await api.backupPresence(backup.id, picks);
    } catch (e) {
      error = `Couldn't check what's already in Bandmate (${(e as Error).message})`;
      phase = 'picking';
      return;
    }
    replacing = { songs: new Set(), beats: new Set() };
    if (present.songs.length + present.beats.length > 0) phase = 'deciding';
    else restore();
  }

  function setReplacing(kind: 'songs' | 'beats', id: number, replace: boolean) {
    const next = new Set(replacing[kind]);
    if (replace) next.add(id);
    else next.delete(id);
    replacing = { ...replacing, [kind]: next };
  }

  function setAll(replace: boolean) {
    const ids = (list: BackupPresent[]) => new Set(replace ? list.map((p) => p.id) : []);
    replacing = { songs: ids(present.songs), beats: ids(present.beats) };
  }

  async function restore() {
    if ('missing' in toRestore) return;
    const { picks } = toRestore;
    if (replacingAny) {
      const ok = confirm(
        replaceConfirmation(
          present.songs.filter((s) => replacing.songs.has(s.id)),
          present.beats.filter((b) => replacing.beats.has(b.id)),
        ),
      );
      if (!ok) return;
    }
    const from = phase;
    phase = 'restoring';
    error = null;
    try {
      const replace = { songs: [...replacing.songs], beats: [...replacing.beats] };
      restored = await api.restoreBackup(backup.id, picks, replace);
      phase = 'restored';
    } catch (e) {
      error = `Couldn't restore (${(e as Error).message})`;
      phase = from === 'deciding' ? 'deciding' : 'picking';
    }
  }

  function oncancel(e: Event) {
    if (phase === 'restoring' || phase === 'checking') e.preventDefault();
  }
</script>

<Dialog
  bind:dialog
  title="Restore"
  close={phase === 'restoring' || phase === 'checking' ? 'hidden' : 'shown'}
  dismissible={() => phase !== 'restoring'}
  {oncancel}
  onclose={onClose}
>
  {#if phase === 'picking' || phase === 'checking'}
    <p class="muted">From “{backupName(backup)}”</p>
    {#if loadError}
      <p class="problem" role="alert">{loadError}</p>
    {:else if songs === null || beats === null}
      <p class="muted">Loading…</p>
    {:else if songs.length === 0 && beats.length === 0}
      <p>This Backup holds no Songs or Beats.</p>
    {:else}
      <fieldset class="choice-group" disabled={phase === 'checking'}>
        <legend>What comes back</legend>
        {#if songs.length > 0}
          <label class="choice-row">
            <input type="checkbox" bind:checked={songsTicked} aria-describedby="restore-songs-note" />
            <span>Songs</span>
          </label>
          <div class="choice-under">
            <p id="restore-songs-note" class="muted">Each Song comes back whole, with the Beats its Clips use.</p>
            {#if songsTicked}
              <PickList items={songs} bind:picked label="Songs to restore" />
              {#if !beatsTicked && songsIn.length > 0}
                <p class="muted">{broughtNote(songsIn.length, brought.size)}</p>
              {/if}
            {/if}
          </div>
        {/if}
        {#if beats.length > 0}
          <label class="choice-row">
            <input type="checkbox" bind:checked={beatsTicked} aria-describedby="restore-beats-note" />
            <span>Beat Library <span class="muted">· {beatCount(beats.length)}</span></span>
          </label>
          <div class="choice-under">
            <p id="restore-beats-note" class="muted">Each Beat comes back with its credit.</p>
            {#if beatsTicked}
              <PickList
                items={beats}
                bind:picked={pickedBeats}
                label="Beats to restore"
                detail={(b) => b.producer}
                locked={brought}
                lockedNote="used by a picked Song"
              />
            {/if}
          </div>
        {/if}
      </fieldset>
      {#if 'missing' in toRestore}
        <p id="restore-missing" class="muted">{toRestore.missing}</p>
      {/if}
      <p class="muted">
        Where a Song or Beat is already in Bandmate, you choose next whether to replace it or keep both. Nothing the
        Backup doesn’t hold is touched.
      </p>
    {/if}
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
  {:else if phase === 'deciding'}
    <p>Already in Bandmate. Keep both adds the restored one alongside, titled “(restored)”.</p>
    <div class="choose-actions">
      <button type="button" class="button quiet" onclick={() => setAll(true)}>Replace all</button>
      <button type="button" class="button quiet" onclick={() => setAll(false)}>Keep all</button>
    </div>
    <div class="present">
      {#each [{ kind: 'songs', name: 'Songs', list: present.songs }, { kind: 'beats', name: 'Beats', list: present.beats }] as const as group (group.kind)}
        {#if group.list.length > 0}
          <section aria-labelledby="present-{group.kind}">
            <h3 id="present-{group.kind}">{group.name}</h3>
            <ul>
              {#each group.list as item (item.id)}
                {@const replace = replacing[group.kind].has(item.id)}
                <li>
                  <span class="title">
                    {item.inBandmate.title}
                    {#if item.inBandmate.title !== item.title}
                      <span class="muted">· “{item.title}” in the Backup</span>
                    {/if}
                  </span>
                  <span class="toggle" role="radiogroup" aria-label={item.inBandmate.title}>
                    <label class:on={!replace}>
                      <input
                        type="radio"
                        name="present-{group.kind}-{item.id}"
                        value="keep"
                        checked={!replace}
                        onchange={() => setReplacing(group.kind, item.id, false)}
                      />
                      Keep both
                    </label>
                    <label class:on={replace} class="replace">
                      <input
                        type="radio"
                        name="present-{group.kind}-{item.id}"
                        value="replace"
                        checked={replace}
                        onchange={() => setReplacing(group.kind, item.id, true)}
                      />
                      Replace
                    </label>
                  </span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {/each}
    </div>
    {#if replacingAny}
      <p class="warning" role="note">
        Replacing a Song makes it the Backup’s version entirely: anything it has now that the Backup’s doesn’t, such as
        newer Takes, Sounds, Masters or its Cover, is lost. Replacing a Beat gives it the Backup’s title, credit, BPM,
        Key and Notes in every Song using it, keeping its audio.
      </p>
    {/if}
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
  {:else if phase === 'restoring'}
    <p role="status" aria-live="polite">Restoring {pickedName}…</p>
    <progress aria-label="Restoring"></progress>
    <p class="muted">Don't leave or close this page until it's done.</p>
  {:else}
    <p role="status">Restored {restoredName(restored.songs.length, restored.beats)}.</p>
    {#if restored.songs.length > 0}
      <ul class="restored">
        {#each restored.songs as song (song.id)}
          <li><a href="/songs/{song.id}" onclick={() => dialog?.close()}>{song.title}</a></li>
        {/each}
      </ul>
    {/if}
    {#if restored.beats > 0}
      <p><a href="/beats" onclick={() => dialog?.close()}>Open the Beat Library</a></p>
    {/if}
  {/if}

  <div class="actions">
    {#if phase === 'picking' || phase === 'checking'}
      {#if songs && beats && (songs.length > 0 || beats.length > 0)}
        <button
          type="button"
          class="button primary"
          onclick={check}
          disabled={'missing' in toRestore || phase === 'checking'}
          aria-describedby={'missing' in toRestore ? 'restore-missing' : undefined}
        >
          Restore {pickedName}
        </button>
      {/if}
      <button type="button" class="button" onclick={() => dialog?.close()} disabled={phase === 'checking'}>
        Cancel
      </button>
    {:else if phase === 'deciding'}
      <button type="button" class={['button', replacingAny ? 'danger' : 'primary']} onclick={restore}>
        {replacingAny ? 'Replace and restore' : 'Restore'}
      </button>
      <button type="button" class="button" onclick={() => ((phase = 'picking'), (error = null))}>Back</button>
    {:else if phase === 'restored'}
      <button type="button" class="button primary" onclick={() => dialog?.close()}>Done</button>
    {/if}
  </div>
</Dialog>

<style>
  p {
    margin: 0;
  }
  .choose-actions {
    display: flex;
    gap: var(--space-4);
  }
  .title {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* About six rows, then it scrolls. */
  .present {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: calc(7.5 * var(--control));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  h3 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-md);
  }
  .present ul {
    margin: 0;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    list-style: none;
  }
  .present li {
    display: flex;
    /* Where the title would be squeezed, as at phone width, the toggle goes under it. */
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    padding-block: var(--space-2);
  }
  .present li + li {
    border-top: 1px solid var(--border);
  }
  .present .title {
    flex: 1 1 8rem;
  }
  .toggle {
    display: inline-flex;
    flex: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .toggle label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2rem;
    padding: 0 var(--space-3);
    font-size: var(--text-md);
    font-weight: 600;
    cursor: pointer;
  }
  .toggle label + label {
    border-left: 1px solid var(--border);
  }
  .toggle input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    min-height: 0;
    margin: 0;
    padding: 0;
  }
  .toggle label.on {
    background: var(--accent);
    color: var(--accent-text);
  }
  .toggle label.replace.on {
    background: var(--danger);
    color: var(--bg);
  }
  .toggle label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .warning {
    color: var(--warning);
    font-size: var(--text-md);
  }
  .restored {
    max-height: calc(6.5 * var(--control));
    overflow-y: auto;
    margin: 0;
    padding-left: var(--space-6);
    overflow-wrap: anywhere;
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
