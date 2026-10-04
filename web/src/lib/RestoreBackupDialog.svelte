<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type Backup, type BackupPresence, type BackupPresent, type BackupSong } from './api';
  import { closeOnBackdrop } from './backdrop';
  import { backupName, replaceConfirmation, songCount } from './backups';

  // "Restore": picks Songs from a Backup, some or all, then restores them,
  // each with the Beats its Clips use, in the same modal dialog, which holds
  // focus until they're back: it can't be closed meanwhile, by a click
  // outside, Esc, or a button. Where Songs or Beats picked are already in
  // Bandmate (the same ones, not just the same titles), a step lists them,
  // each to replace or keep both, keep both by default, which adds the
  // restored one alongside as "Title (restored)". Replacing any asks for a
  // confirmation naming them first.
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
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let picked = $state<Set<number>>(new Set());
  // What's already in Bandmate of what's picked, and which of it to
  // replace, by kind and id in the Backup.
  let present = $state<BackupPresence>({ songs: [], beats: [] });
  let replacing = $state<{ songs: Set<number>; beats: Set<number> }>({ songs: new Set(), beats: new Set() });
  let restored = $state<BackupSong[]>([]);
  const replacingAny = $derived(replacing.songs.size + replacing.beats.size > 0);

  onMount(() => dialog?.showModal());

  // svelte-ignore state_referenced_locally
  api.backupSongs(backup.id).then(
    (list) => {
      songs = list;
      // One Song is the one to restore.
      if (list.length === 1) picked = new Set([list[0].id]);
    },
    (e: Error) => (loadError = e.message),
  );

  function toggle(id: number) {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    picked = next;
  }

  // Asks which of the Songs picked, and of their Beats, are already in
  // Bandmate: if any are, the user says which to replace first.
  async function check() {
    phase = 'checking';
    error = null;
    try {
      present = await api.backupPresence(backup.id, [...picked]);
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
      restored = (await api.restoreBackup(backup.id, [...picked], replace)).songs;
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

<dialog
  bind:this={dialog}
  {@attach closeOnBackdrop(() => phase !== 'restoring')}
  {oncancel}
  onclose={onClose}
  aria-labelledby="restore-backup-heading"
>
  <header>
    <h2 id="restore-backup-heading">Restore</h2>
    {#if phase !== 'restoring' && phase !== 'checking'}
      <button type="button" class="icon" onclick={() => dialog?.close()} aria-label="Close">✕</button>
    {/if}
  </header>

  {#if phase === 'picking' || phase === 'checking'}
    <p class="muted">From “{backupName(backup)}”</p>
    {#if loadError}
      <p class="problem" role="alert">{loadError}</p>
    {:else if songs === null}
      <p class="muted">Loading…</p>
    {:else if songs.length === 0}
      <p>This Backup holds no Songs.</p>
    {:else}
      <div class="choose">
        <div class="choose-actions">
          <button type="button" class="link" onclick={() => (picked = new Set(songs?.map((s) => s.id)))}>
            Choose all
          </button>
          <button type="button" class="link" onclick={() => (picked = new Set())} disabled={picked.size === 0}>
            Clear
          </button>
        </div>
        <ul class="songs" aria-label="Songs to restore">
          {#each songs as song (song.id)}
            <li>
              <label>
                <input type="checkbox" checked={picked.has(song.id)} onchange={() => toggle(song.id)} />
                <span class="title">{song.title}</span>
              </label>
            </li>
          {/each}
        </ul>
      </div>
      <p class="muted">
        Each Song comes back whole, with the Beats its Clips use. Where one is already in Bandmate, you choose next
        whether to replace it or keep both.
      </p>
    {/if}
    {#if error}
      <p class="problem" role="alert">{error}</p>
    {/if}
  {:else if phase === 'deciding'}
    <p>Already in Bandmate. Keep both adds the restored one alongside, titled “(restored)”.</p>
    <div class="choose-actions">
      <button type="button" class="link" onclick={() => setAll(true)}>Replace all</button>
      <button type="button" class="link" onclick={() => setAll(false)}>Keep all</button>
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
    <p role="status" aria-live="polite">Restoring {songCount(picked.size)}…</p>
    <progress aria-label="Restoring"></progress>
    <p class="muted">Don't leave or close this page until it's done.</p>
  {:else}
    <p role="status">Restored {songCount(restored.length)}.</p>
    <ul class="restored">
      {#each restored as song (song.id)}
        <li><a href="/songs/{song.id}" onclick={() => dialog?.close()}>{song.title}</a></li>
      {/each}
    </ul>
  {/if}

  <div class="actions">
    {#if phase === 'picking' || phase === 'checking'}
      {#if songs && songs.length > 0}
        <button
          type="button"
          class="button primary"
          onclick={check}
          disabled={picked.size === 0 || phase === 'checking'}
        >
          Restore {picked.size > 0 ? songCount(picked.size) : ''}
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
</dialog>

<style>
  dialog {
    width: min(28rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--bg);
    color: var(--text);
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  h2 {
    margin: 0;
    font-size: 1.125rem;
  }
  p {
    margin: 0;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--control);
    cursor: pointer;
  }
  label input {
    flex: none;
    width: 1.25rem;
    height: 1.25rem;
    min-height: 0;
    margin: 0;
    padding: 0;
    accent-color: var(--accent);
  }
  .choose {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-height: 0;
  }
  .choose-actions {
    display: flex;
    gap: 1rem;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }
  .link:disabled {
    color: var(--text-muted);
    cursor: default;
  }
  /* About six Songs, then it scrolls. */
  .songs {
    max-height: calc(6.5 * var(--control));
    overflow-y: auto;
    margin: 0;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    list-style: none;
    overscroll-behavior: contain;
  }
  .songs label {
    padding-block: 0.25rem;
  }
  .title {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* About six rows, then it scrolls. */
  .present {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: calc(7.5 * var(--control));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  h3 {
    margin: 0 0 0.25rem;
    font-size: 0.875rem;
  }
  .present ul {
    margin: 0;
    padding: 0 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    list-style: none;
  }
  .present li {
    display: flex;
    /* Where the title would be squeezed, as at phone width, the toggle goes under it. */
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem 0.75rem;
    padding-block: 0.375rem;
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
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .toggle label {
    min-height: 2rem;
    padding: 0 0.625rem;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .toggle label + label {
    border-left: 1px solid var(--border);
  }
  .toggle input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
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
    font-size: 0.875rem;
  }
  .restored {
    max-height: calc(6.5 * var(--control));
    overflow-y: auto;
    margin: 0;
    padding-left: 1.25rem;
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
    font-size: 0.875rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
