<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    api,
    ApiError,
    commonKeys,
    type Song,
    type SongAt,
    type SongChanges,
    type Status,
    type Timeline as TimelineData,
  } from '../lib/api';
  import LyricSheet from '../lib/LyricSheet.svelte';
  import Masters from '../lib/Masters.svelte';
  import Scrapbook from '../lib/Scrapbook.svelte';
  import StatusBadge from '../lib/StatusBadge.svelte';
  import Timeline from '../lib/Timeline.svelte';
  import type { Saved } from '../lib/history';
  import { navigate } from '../lib/router.svelte';
  import { timeAgo } from '../lib/time';

  let { id }: { id: number } = $props();

  // What the inputs show. Numbers stay text while typing.
  interface Draft {
    title: string;
    status: Status;
    key: string;
    bpm: string;
    capo: string;
    tuning: string;
    notes: string;
  }

  let song = $state<Song | null>(null);
  let timeline = $state<TimelineData | null>(null);
  // Where the Timeline is playing, in seconds; null while it isn't.
  let playhead = $state<number | null>(null);
  let timelinePanel = $state<Timeline>();
  let lyricSheet = $state<LyricSheet>();
  // Whether Tap mode is on: switched on the Timeline, and cueing Lines in the Lyric Sheet.
  let tapping = $state(false);
  let draft = $state<Draft>(toDraft(null));
  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  // A write was refused, or a refresh couldn't be shown, because the Song
  // changed elsewhere (e.g. in another tab) since this page loaded it.
  let stale = $state(false);
  let pending = $state(0);
  let deleting = $state(false);

  const commonTunings = ['Standard', 'Drop D', 'Half step down', 'DADGAD', 'Open G', 'Open D'];

  $effect(() => {
    Promise.all([api.getSong(id), api.getTimeline(id)]).then(
      ([s, tl]) => {
        song = s;
        timeline = tl;
        draft = toDraft(s);
      },
      (e: Error) => (loadError = e.message),
    );
  });

  function toDraft(s: Song | null): Draft {
    return {
      title: s?.title ?? '',
      status: s?.status ?? 'idea',
      key: s?.key ?? '',
      bpm: s?.bpm?.toString() ?? '',
      capo: s?.capo?.toString() ?? '',
      tuning: s?.tuning ?? '',
      notes: s?.notes ?? '',
    };
  }

  // Saves run one after another so they land in the order they were made.
  let queue = Promise.resolve();

  /**
   * Queues a change and shows the Song it returns. The change is based on
   * the Song as shown when its turn comes. Resolves to whether it succeeded.
   */
  function send(op: (at: SongAt) => Promise<Song>): Promise<boolean> {
    return enqueue(op, (s) => (song = s));
  }

  /**
   * Queues a Timeline change like send, and shows the Timeline it returns,
   * or for a Cue edit, which the Timeline keeps to undo, the Song.
   */
  function changeTimeline(op: (at: SongAt) => Promise<Saved>): Promise<boolean> {
    return enqueue(op, (saved) => {
      if ('song' in saved) {
        song = saved.song;
        return;
      }
      timeline = saved.timeline;
      // The change moved the Song on too.
      song = { ...song!, version: timeline.version, updatedAt: timeline.updatedAt };
    });
  }

  /** Queues a Cue edit through the Timeline, so it can be undone with the Timeline's edits. */
  function editCues(op: (at: SongAt) => Promise<Song>): Promise<boolean> {
    return timelinePanel ? timelinePanel.editCues(op) : send(op);
  }

  function enqueue<T>(op: (at: SongAt) => Promise<T>, show: (result: T) => void): Promise<boolean> {
    // Once the Song is being deleted, a late save would only fail.
    if (deleting) return Promise.resolve(false);
    pending++;
    const done = queue.then(async () => {
      try {
        show(await op(song!));
        saveError = null;
        return true;
      } catch (e) {
        showError(e as Error);
        return false;
      } finally {
        pending--;
      }
    });
    queue = done.then(() => {});
    return done;
  }

  function showError(e: Error) {
    if (e instanceof ApiError && e.stale) stale = true;
    else saveError = e.message;
  }

  async function save(changes: SongChanges, fields: (keyof Draft)[]) {
    let rejectedAsStale = false;
    const ok = await send((at) =>
      api.updateSong(at, changes).catch((e) => {
        rejectedAsStale = e instanceof ApiError && e.stale;
        throw e;
      }),
    );
    // Put back what the server has for the fields that failed, unless the
    // Song changed elsewhere: then the edits stay, to be copied out.
    if (!ok && !rejectedAsStale) {
      for (const f of fields) revert(f);
    }
  }

  // Coming back to the tab shows what changed meanwhile, e.g. on another
  // device. It waits for saves already on their way, and never replaces
  // edits not saved yet: those are based on the Song as it was, so the Song
  // is marked stale instead.
  function refresh() {
    if (document.visibilityState !== 'visible' || !song || deleting) return;
    queue = queue.then(async () => {
      try {
        const latest = await api.getSong(id);
        if (latest.version === song?.version) return;
        if (hasUnsavedEdits()) {
          stale = true;
          return;
        }
        const latestTimeline = await api.getTimeline(id);
        // A focused field would keep showing the old Song, and typing into
        // it would then overwrite the change made elsewhere. Nothing is
        // unsaved, so leaving it saves nothing.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        song = latest;
        timeline = latestTimeline;
        draft = toDraft(latest);
        stale = false;
      } catch {
        // Keep showing the Song as it was; the next save reports any problem.
      }
    });
  }

  // Set while reloading on purpose, so leaving doesn't ask again.
  let reloading = false;

  function reload() {
    if (hasUnsavedEdits() && !confirm('Reload the Song? Edits that weren’t saved here will be lost.')) return;
    reloading = true;
    location.reload();
  }

  // Lyric Sheet editors holding edits that aren't saved yet.
  const unsavedEditors = new Set<object>();

  function setUnsaved(editor: object, unsaved: boolean) {
    if (unsaved) unsavedEditors.add(editor);
    else unsavedEditors.delete(editor);
  }

  /** Shows what the server has for one field again. */
  function revert<F extends keyof Draft>(field: F) {
    draft[field] = toDraft(song)[field];
  }

  /** Sets the BPM, e.g. copied from a Beat when asked to. */
  function setBpm(bpm: number) {
    draft.bpm = String(bpm);
    save({ bpm }, ['bpm']);
  }

  function setStatus(status: Status) {
    draft.status = status;
    save({ status }, ['status']);
  }

  function commitText(field: 'title' | 'key' | 'tuning' | 'notes') {
    if (!song) return;
    const value = field === 'notes' ? draft.notes : draft[field].trim();
    if (value === song[field]) {
      revert(field);
      return;
    }
    save({ [field]: value }, [field]);
  }

  function commitNumber(field: 'bpm' | 'capo', label: string) {
    if (!song) return;
    const text = draft[field].trim();
    if (text !== '' && !/^\d+$/.test(text)) {
      saveError = `${label} must be a whole number`;
      revert(field);
      return;
    }
    const value = text === '' ? null : Number(text);
    if (value === song[field]) {
      revert(field);
      return;
    }
    save({ [field]: value }, [field]);
  }

  function commitAll() {
    for (const f of ['title', 'key', 'tuning', 'notes'] as const) commitText(f);
    commitNumber('bpm', 'BPM');
    commitNumber('capo', 'Capo');
  }

  // Inputs save on change, which fires on blur. Leaving with the browser's
  // back button doesn't blur, so save whatever is still being edited.
  onDestroy(commitAll);

  function hasUnsavedEdits() {
    if (!song) return false;
    if (pending > 0 || unsavedEditors.size > 0) return true;
    const saved = toDraft(song);
    return (Object.keys(saved) as (keyof Draft)[]).some(
      (f) => (f === 'notes' ? draft[f] : draft[f].trim()) !== saved[f],
    );
  }

  // Closing or reloading the tab can't wait for a save, so ask first.
  function warnBeforeUnload(event: BeforeUnloadEvent) {
    if (!reloading && hasUnsavedEdits()) event.preventDefault();
  }

  async function remove() {
    if (!song) return;
    const ok = confirm(`Delete “${song.title}”?\n\nThis removes the Song and everything in it. It can't be undone.`);
    if (!ok) return;
    deleting = true;
    try {
      // Let queued saves finish first, so none of them lands after the delete.
      await queue;
      await api.deleteSong(song);
      navigate('/', { replace: true });
    } catch (e) {
      showError(e as Error);
      deleting = false;
    }
  }
</script>

<svelte:window onbeforeunload={warnBeforeUnload} />
<svelte:document onvisibilitychange={refresh} />

<header class="bar wide">
  <a class="back" href="/">← Songs</a>
  {#if song}
    <button type="button" class="button danger" onclick={remove} disabled={deleting}>
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  {/if}
</header>

<main class="page wide">
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if song === null}
    <p class="muted">Loading…</p>
  {:else}
    <div class="song">
      <div class="top">
        <label class="visually-hidden" for="song-title">Title</label>
        <input
          id="song-title"
          class="title"
          bind:value={draft.title}
          onchange={() => commitText('title')}
          required
          autocomplete="off"
          enterkeyhint="done"
        />

        <div class="meta">
          <StatusBadge status={draft.status} onChange={setStatus} />
          <span class="muted" aria-hidden="true">·</span>
          <p class="save-state muted" role="status">
            {#if pending > 0}
              Saving…
            {:else}
              Edited <time datetime={song.updatedAt}>{timeAgo(song.updatedAt)}</time>
            {/if}
          </p>
        </div>
        {#if stale}
          <div class="stale" role="alert">
            <p>
              This Song changed elsewhere, so edits made here since can’t be saved. Reload to see the latest.
              Edits that weren’t saved stay where you typed them until then, so copy out anything you want to keep.
            </p>
            <button type="button" class="button" onclick={reload}>Reload</button>
          </div>
        {/if}
        {#if saveError}
          <p class="error" role="alert">{saveError}</p>
        {/if}
      </div>

      <div class="sheet">
        <LyricSheet
          bind:this={lyricSheet}
          {song}
          change={send}
          {editCues}
          onUnsaved={setUnsaved}
          {playhead}
          seek={(to) => timelinePanel?.seekTo(to)}
          {tapping}
          hasClips={timeline?.tracks.some((t) => t.clips.length > 0) ?? false}
        />
      </div>

      <aside class="side">
        <Scrapbook {song} change={send} onUnsaved={setUnsaved} />
      </aside>

      <div class="about">
        <Masters {song} change={send} onUnsaved={setUnsaved} {setStatus} />

        <section class="details" aria-labelledby="details-heading">
          <h2 id="details-heading">Details</h2>
          <div class="grid">
            <label>
              Key
              <input
                bind:value={draft.key}
                onchange={() => commitText('key')}
                list="common-keys"
                autocomplete="off"
                autocapitalize="characters"
                enterkeyhint="done"
                placeholder="—"
              />
            </label>
            <label>
              BPM
              <input
                bind:value={draft.bpm}
                onchange={() => commitNumber('bpm', 'BPM')}
                inputmode="numeric"
                autocomplete="off"
                enterkeyhint="done"
                placeholder="—"
              />
            </label>
            <label>
              Capo
              <input
                bind:value={draft.capo}
                onchange={() => commitNumber('capo', 'Capo')}
                inputmode="numeric"
                autocomplete="off"
                enterkeyhint="done"
                placeholder="—"
              />
            </label>
            <label>
              Tuning
              <input
                bind:value={draft.tuning}
                onchange={() => commitText('tuning')}
                list="common-tunings"
                autocomplete="off"
                enterkeyhint="done"
                placeholder="—"
              />
            </label>
          </div>
          <label>
            Notes
            <textarea bind:value={draft.notes} onchange={() => commitText('notes')} rows="5"></textarea>
          </label>
        </section>
      </div>
    </div>

    <datalist id="common-keys">
      {#each commonKeys as k (k)}<option value={k}></option>{/each}
    </datalist>
    <datalist id="common-tunings">
      {#each commonTunings as t (t)}<option value={t}></option>{/each}
    </datalist>
  {/if}
</main>

{#if song && timeline}
  <Timeline
    bind:this={timelinePanel}
    bind:tapping
    {song}
    {timeline}
    change={changeTimeline}
    {setBpm}
    onPlayhead={(at) => (playhead = at)}
    onTap={(at) => lyricSheet?.tap(at)}
  />
{/if}

<style>
  .title {
    min-height: 3rem;
    margin: 0 0 0.25rem;
    padding: 0.25rem 0.5rem;
    margin-left: -0.5rem;
    width: calc(100% + 0.5rem);
    border-color: transparent;
    background: transparent;
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.2;
  }
  .title:hover,
  .title:focus {
    border-color: var(--border);
    background: var(--surface-1);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 0.5rem;
    margin: 0 0 0.75rem;
    font-size: 0.8125rem;
  }
  .save-state {
    margin: 0;
  }
  .error {
    margin-bottom: 1rem;
  }
  .stale {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    margin-bottom: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--surface-1);
  }
  .stale p {
    flex: 1 1 16rem;
    margin: 0;
  }
  .details h2 {
    font-size: 1rem;
    margin: 0 0 0.75rem;
  }
  .details label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .details input,
  .details textarea {
    color: var(--text);
    font-weight: 400;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .side {
    margin-bottom: 2rem;
  }

  @media (min-width: 36rem) {
    .grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  /* On wide screens the Scrapbook sits beside the rest of the Song, and
     stays in view while the Lyric Sheet scrolls. On phones it follows the
     Lyric Sheet in one column. */
  @media (min-width: 64rem) {
    .song {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 22rem;
      grid-template-rows: auto auto 1fr;
      grid-template-areas:
        'top side'
        'sheet side'
        'about side';
      column-gap: 2rem;
    }
    .top {
      grid-area: top;
    }
    .sheet {
      grid-area: sheet;
    }
    .about {
      grid-area: about;
      align-self: start;
    }
    .side {
      grid-area: side;
      align-self: start;
      position: sticky;
      top: 4.5rem;
      max-height: calc(100vh - 5.5rem);
      overflow-y: auto;
    }
  }
</style>
