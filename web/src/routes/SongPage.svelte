<script lang="ts">
  import { onDestroy } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
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
  import Combobox from '../lib/Combobox.svelte';
  import LyricSheet from '../lib/LyricSheet.svelte';
  import Masters from '../lib/Masters.svelte';
  import Scrapbook from '../lib/Scrapbook.svelte';
  import { dropsOnScrapbook } from '../lib/sectionDrag';
  import { SectionDragging } from '../lib/sectionDragging.svelte';
  import EditCover from '../lib/EditCover.svelte';
  import SongCover from '../lib/SongCover.svelte';
  import StatusBadge from '../lib/StatusBadge.svelte';
  import Timeline from '../lib/Timeline.svelte';
  import type { Saved } from '../lib/history';
  import { takeNewFlag } from '../lib/newSong';
  import { navigate, replaceSearch, router } from '../lib/router.svelte';
  import { finePointer, keyHints } from '../lib/keyHints';
  import { shortcutsDialogKeys } from '../lib/shortcuts';
  import ShortcutsDialog from '../lib/ShortcutsDialog.svelte';
  import { keyPlace } from '../lib/keyPlace';
  import { opensShortcuts } from '../lib/songKeys';
  import { detailsSummary, openingMode, sideParts, type Mode, type SidePart } from '../lib/songMode';
  import { hasChords } from '../lib/chords';
  import { songChordsShown } from '../lib/chordsShown';
  import { songTranspose } from '../lib/sharedTranspose.svelte';
  import { timeAgo } from '../lib/time';

  let { id }: { id: number } = $props();

  // A Song just made with "New Song" opens with its title focused and
  // selected, ready to type over, just this once: the flag saying so comes
  // out of the URL straight away, so a reload or Back/Forward doesn't.
  const { isNew, rest: queryWithoutFlag } = takeNewFlag(router.search);
  if (isNew) replaceSearch(queryWithoutFlag);
  let titleAwaitsFocus = isNew;

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
  // Whether the Timeline's Loop is on, which keeps Sync mode in the Lyric Sheet off.
  let loopOn = $state(false);
  // Sync mode and recording are exclusive: neither starts while the other's on.
  let syncing = $state(false);
  // Whether the Timeline is recording, from pressing Record until the Take
  // is saved. Meanwhile no Master plays, the Song can't be deleted, leaving
  // asks first, and changes made elsewhere wait to be shown.
  let recording = $state(false);
  let draft = $state<Draft>(toDraft(null));
  let loadError = $state<string | null>(null);
  let saveError = $state<string | null>(null);
  // A write was refused, or a refresh couldn't be shown, because the Song
  // changed elsewhere (e.g. in another tab) since this page loaded it.
  let stale = $state(false);
  let pending = $state(0);
  let deleting = $state(false);
  // Read mode offers no editing anywhere on the page but the Timeline. It's
  // never saved: each visit starts from the Song's Status.
  let mode = $state<Mode>('write');
  const writing = $derived(mode === 'write');
  // How far Read mode shows the Chords transposed: by the Lyric Sheet's
  // amount while they show, and not at all while they're hidden or there are none.
  const transpose = $derived(song && hasChords(song) && songChordsShown.of(id) ? songTranspose.of(id) : 0);
  // The Details as Read mode shows them, with the key the Chords are shown in.
  const summary = $derived(detailsSummary(draft, transpose));
  const hasNotes = $derived(draft.notes.trim() !== '');

  // Whether the Notes under the Details are showing. They start hidden.
  let notesOpen = $state(false);

  // Desktop puts the Scrapbook and Masters in a column beside the Lyric
  // Sheet, as sections that open and close, each as sideParts starts it on
  // each visit until it's toggled. Narrower windows show them after the
  // Lyric Sheet, always open. Keyed by name, switching moves them rather
  // than rebuilding them.
  const desktop = new MediaQuery('min-width: 80rem');
  const parts = $derived(sideParts(mode));
  // Parts opened or closed by hand, per mode.
  let toggledParts = $state<Partial<Record<`${Mode}-${SidePart}`, boolean>>>({});

  function partOpen(part: SidePart, startsOpen: boolean): boolean {
    return !desktop.current || (toggledParts[`${mode}-${part}`] ?? startsOpen);
  }

  // Setting open also fires toggle, so only a change to what's shown was a
  // hand's.
  function toggled(part: SidePart, startsOpen: boolean, open: boolean) {
    if (desktop.current && open !== partOpen(part, startsOpen)) toggledParts[`${mode}-${part}`] = open;
  }
  // A Section is dragged within the Lyric Sheet, or between it and the
  // Scrapbook, and an Alternate out of its Section into either, on desktop
  // in Write mode. The Arrangement or the Scrapbook changing mid-drag
  // cancels it.
  const drag = new SectionDragging(
    () => desktop.current && writing,
    () => (song ? `${song.arrangement}|${song.scrapbook}` : ''),
  );
  // The shortcuts dialog, opened by its button or ?. Shortcuts are for a
  // keyboard and mouse, so the button only shows with a fine pointer, and
  // never on a phone.
  let showingShortcuts = $state(false);
  const hints = keyHints();

  function openShortcutsOnKey(event: KeyboardEvent) {
    const opens = opensShortcuts(event, keyPlace(event));
    if (!opens || !song) return;
    event.preventDefault();
    showingShortcuts = true;
  }

  // How tall the docked Timeline is, which the side column stops above.
  let timelineHeight = $state(0);

  const commonTunings = ['Standard', 'Drop D', 'Half step down', 'DADGAD', 'Open G', 'Open D'];

  $effect(() => {
    Promise.all([api.getSong(id), api.getTimeline(id)]).then(
      ([s, tl]) => {
        song = s;
        timeline = tl;
        draft = toDraft(s);
        mode = openingMode(s.status);
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

  // Coming back to the tab while recording, the refresh waits until the Take's saved.
  let refreshAfterRecording = false;
  $effect(() => {
    if (recording || !refreshAfterRecording) return;
    refreshAfterRecording = false;
    refresh();
  });

  // Coming back to the tab shows what changed meanwhile, e.g. on another
  // device. It waits for saves already on their way, and never replaces
  // edits not saved yet: those are based on the Song as it was, so the Song
  // is marked stale instead.
  function refresh() {
    if (document.visibilityState !== 'visible' || !song || deleting) return;
    // Not under a recording: the Timeline it's made against stays as it is.
    if (recording) {
      refreshAfterRecording = true;
      return;
    }
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

  // The title wraps in Write mode as it does in Read mode, so switching
  // doesn't move the page: its box grows to fit, again as its width changes.
  function fitTitle(el: HTMLTextAreaElement) {
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    const resized = new ResizeObserver(fit);
    resized.observe(el);
    $effect(() => {
      void draft.title;
      fit();
    });
    return () => resized.disconnect();
  }

  function focusNewTitle(el: HTMLTextAreaElement) {
    if (!titleAwaitsFocus) return;
    titleAwaitsFocus = false;
    el.focus();
    el.select();
  }

  // A title is one line: Enter saves it, and a pasted line break is a space.
  function oneLine(event: Event & { currentTarget: HTMLTextAreaElement }) {
    if (/[\r\n]/.test(event.currentTarget.value))
      draft.title = event.currentTarget.value.replace(/\s*[\r\n]+\s*/g, ' ');
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

  // Closing or reloading the tab can't wait for a save, or a recording, so ask first.
  function warnBeforeUnload(event: BeforeUnloadEvent) {
    if (!reloading && (recording || hasUnsavedEdits())) event.preventDefault();
  }

  async function remove() {
    if (!song || recording) return;
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

{#snippet notesToggle()}
  <button
    type="button"
    class="button notes-toggle"
    class:has-notes={hasNotes}
    aria-expanded={notesOpen}
    aria-controls={notesOpen ? 'song-notes' : undefined}
    onclick={() => (notesOpen = !notesOpen)}
  >
    Notes
  </button>
{/snippet}

<svelte:window onbeforeunload={warnBeforeUnload} onkeydown={openShortcutsOnKey} />
<svelte:document onvisibilitychange={refresh} />

<main class="page" style:--timeline-height="{timelineHeight}px">
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if song === null}
    <p class="muted">Loading…</p>
  {:else}
    <div class="song">
      <div class="top">
        <div class="head">
          {#if writing}
            <EditCover
              songId={song.id}
              cover={song.cover}
              title={draft.title}
              status={draft.status}
              change={send}
              onError={(m) => (saveError = m)}
            />
          {:else}
            <SongCover
              songId={song.id}
              coverId={song.cover?.id ?? null}
              title={draft.title}
              status={draft.status}
              size="header"
            />
          {/if}
          <div class="head-main">
            <div class="title-block">
              {#if writing}
                <label class="visually-hidden" for="song-title">Title</label>
                <textarea
                  id="song-title"
                  class="title"
                  rows="1"
                  bind:value={draft.title}
                  {@attach fitTitle}
                  {@attach focusNewTitle}
                  oninput={oneLine}
                  onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
                  onchange={() => commitText('title')}
                  required
                  autocomplete="off"
                  enterkeyhint="done"></textarea>
              {:else}
                <h1 class="title">{draft.title}</h1>
              {/if}
              <div class="meta">
                <StatusBadge status={draft.status} onChange={writing ? setStatus : undefined} />
                <span class="muted" aria-hidden="true">·</span>
                <p class="save-state muted" role="status">
                  {#if pending > 0}
                    Saving…
                  {:else}
                    Edited <time datetime={song.updatedAt}>{timeAgo(song.updatedAt)}</time>
                  {/if}
                </p>
              </div>
            </div>
            <div class="head-tools">
              <fieldset class="modes" disabled={deleting}>
                <legend class="visually-hidden">Mode</legend>
                <label class="mode"><input type="radio" name="song-mode" value="write" bind:group={mode} />Write</label>
                <label class="mode"><input type="radio" name="song-mode" value="read" bind:group={mode} />Read</label>
              </fieldset>
              {#if finePointer()}
                <button
                  type="button"
                  class="button shortcuts"
                  onclick={() => (showingShortcuts = true)}
                  aria-label="Keyboard shortcuts"
                  aria-haspopup="dialog"
                  aria-keyshortcuts={hints.aria(shortcutsDialogKeys)}
                  title={hints.withKeys('Keyboard shortcuts', shortcutsDialogKeys)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="2" y="5" width="20" height="14" rx="2.5" />
                    <path d="M6 9.5h.01M10 9.5h.01M14 9.5h.01M18 9.5h.01M8 12.5h.01M12 12.5h.01M16 12.5h.01" />
                    <path d="M8 15.5h8" />
                  </svg>
                </button>
              {/if}
            </div>
          </div>
        </div>

        <!-- The Details, small enough to sit under the Status at any width. -->
        <section class="details" aria-label="Details">
          {#if writing}
            <div class="fields">
              <label class="field key" for="song-key">
                Key
                <Combobox
                  id="song-key"
                  bind:value={draft.key}
                  options={commonKeys}
                  saved={song.key}
                  onpick={() => commitText('key')}
                  onchange={() => commitText('key')}
                  autocomplete="off"
                  autocapitalize="characters"
                  enterkeyhint="done"
                  placeholder="—"
                />
              </label>
              <label class="field bpm">
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
              <label class="field capo">
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
              <label class="field tuning" for="song-tuning">
                Tuning
                <Combobox
                  id="song-tuning"
                  bind:value={draft.tuning}
                  options={commonTunings}
                  saved={song.tuning}
                  onpick={() => commitText('tuning')}
                  onchange={() => commitText('tuning')}
                  autocomplete="off"
                  enterkeyhint="done"
                  placeholder="—"
                />
              </label>
              {@render notesToggle()}
            </div>
            {#if notesOpen}
              <label class="notes">
                <span class="visually-hidden">Notes</span>
                <textarea id="song-notes" bind:value={draft.notes} onchange={() => commitText('notes')} rows="4"
                ></textarea>
              </label>
            {/if}
          {:else}
            <div class="fields">
              <p class="summary" class:muted={!summary}>{summary || 'No Details yet.'}</p>
              {#if hasNotes}{@render notesToggle()}{/if}
            </div>
            {#if notesOpen && hasNotes}
              <p id="song-notes" class="read-notes">{draft.notes}</p>
            {/if}
          {/if}
        </section>

        {#if stale}
          <div class="stale" role="alert">
            <p>
              This Song changed elsewhere, so edits made here since can’t be saved. Reload to see the latest. Edits that
              weren’t saved stay where you typed them until then, so copy out anything you want to keep.
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
          {song}
          {mode}
          change={send}
          {drag}
          {editCues}
          onUnsaved={setUnsaved}
          {playhead}
          playFrom={(at) => timelinePanel?.playFrom(at)}
          playheadAt={() => timelinePanel?.playheadAt() ?? 0}
          {loopOn}
          stopLoop={() => timelinePanel?.stopLoop()}
          {recording}
          bind:syncing
          hasClips={timeline?.tracks.some((t) => t.clips.length > 0) ?? false}
        />
      </div>

      <!-- On desktop, a column beside the Lyric Sheet whose sections are
           named by their toggles. Narrower, its parts follow the Lyric Sheet,
           always open. -->
      <div class="side">
        {#each parts as { part, open: startsOpen } (part)}
          <details
            class="part {part}-part"
            class:drop-target={part === 'scrapbook' && dropsOnScrapbook(drag.drop)}
            {@attach (el) => (part === 'scrapbook' ? drag.placeScrapbook(el) : undefined)}
            open={partOpen(part, startsOpen)}
            ontoggle={(e) => toggled(part, startsOpen, e.currentTarget.open)}
          >
            {#if part === 'masters'}
              <summary>{song.masters.length > 1 ? 'Masters' : 'Master'}</summary>
              <Masters {song} {mode} change={send} onUnsaved={setUnsaved} {setStatus} {recording} />
            {:else}
              <summary>Scrapbook</summary>
              <Scrapbook {song} change={send} {drag} onUnsaved={setUnsaved} onEditing={() => (syncing = false)} />
            {/if}
          </details>
        {/each}
      </div>

      <!-- Last in the markup so it's reached last, though desktop shows it
           beside the title. -->
      {#if writing}
        <button
          type="button"
          class="button danger delete"
          onclick={remove}
          disabled={deleting || recording}
          title={recording ? 'Stop recording to delete' : undefined}
        >
          {deleting ? 'Deleting…' : 'Delete Song'}
        </button>
      {/if}
    </div>
  {/if}
</main>

{#if song && timeline}
  <Timeline
    bind:this={timelinePanel}
    bind:height={timelineHeight}
    {song}
    {timeline}
    change={changeTimeline}
    {setBpm}
    onPlayhead={(at) => (playhead = at)}
    onLoop={(on) => (loopOn = on)}
    {syncing}
    onRecording={(on) => (recording = on)}
  />
{/if}

{#if showingShortcuts}
  <ShortcutsDialog onClose={() => (showingShortcuts = false)} />
{/if}

<style>
  /* The title and its heading wrap alike and are as tall as each other,
     one line being 3rem, so switching mode doesn't shift the page. */
  .title {
    display: block;
    min-height: 3rem;
    margin: 0 0 0.25rem;
    padding: calc((3rem - 1.2em - 2px) / 2) 0.5rem;
    margin-left: -0.5rem;
    width: calc(100% + 0.5rem);
    border-color: transparent;
    background: transparent;
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.2;
  }
  h1.title,
  textarea.title {
    border: 1px solid transparent;
    overflow-wrap: anywhere;
  }
  textarea.title {
    overflow: hidden;
    resize: none;
  }
  textarea.title:hover,
  textarea.title:focus {
    border-color: var(--border);
    background: var(--surface-1);
  }
  /* With no header row, the page keeps clear of a notch itself. It fills the
     window down to the docked Timeline, so on a short Song the spare space
     goes above the Timeline rather than below it. */
  .page {
    padding-top: max(var(--gutter), env(safe-area-inset-top));
    min-height: calc(100dvh - var(--nav-bottom-space) - var(--timeline-height));
  }
  /* The Cover beside the title and Status, with the mode switch at the end
     of the title's line. */
  .head {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }
  .head-main {
    display: flex;
    flex: 1;
    align-items: flex-start;
    gap: 0.75rem;
    min-width: 0;
  }
  .title-block {
    flex: 1;
    min-width: 0;
  }
  /* The mode switch, then the shortcuts button. */
  .head-tools {
    display: flex;
    flex: none;
    gap: 0.5rem;
  }
  .shortcuts {
    width: var(--control);
    padding: 0;
  }
  /* A keyboard: key dots and a space bar, outlined like the Timeline's Rename. */
  .shortcuts svg {
    width: calc(0.6 * var(--control));
    height: calc(0.6 * var(--control));
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .modes {
    display: flex;
    flex: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .mode {
    display: flex;
    align-items: center;
    min-height: var(--control);
    padding: 0 0.875rem;
    background: var(--surface-1);
    font-weight: 600;
    cursor: pointer;
  }
  .mode + .mode {
    border-left: 1px solid var(--border);
  }
  .mode input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    min-height: 0;
  }
  .mode:has(input:checked) {
    background: var(--surface-2);
  }
  .mode:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    /* As tall as the Status picker, which Read mode shows as a plain badge. */
    min-height: var(--control);
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
  /* The Details: small labelled fields in a row that wraps, the Notes
     toggle last. */
  .details {
    margin: 0 0 0.75rem;
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.5rem 0.75rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .field :global(input) {
    color: var(--text);
    font-weight: 400;
  }
  /* Room for a key like "C#m" beside the suggestions' ▾. */
  .key :global(input) {
    width: 5.5rem;
  }
  .bpm input,
  .capo input {
    width: 3.75rem;
  }
  .tuning {
    flex: 0 1 9rem;
    min-width: 6rem;
  }
  .notes-toggle {
    gap: 0.375rem;
  }
  /* A dot says there are Notes behind the toggle. */
  .notes-toggle.has-notes::after {
    content: '';
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
    background: var(--accent);
  }
  .notes {
    display: block;
    margin-top: 0.5rem;
  }
  .summary,
  .read-notes {
    margin: 0;
  }
  .summary {
    font-size: 0.875rem;
  }
  .read-notes {
    margin-top: 0.5rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* A phone: the Cover beside just the title and Status, the mode switch
     on a row of its own across the page, and the Details filling the width
     in two even rows, Tuning and the Notes toggle on the second. */
  @media (width < 40rem) {
    .head {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas:
        'cover title'
        'modes modes';
      gap: 0 0.75rem;
      margin-bottom: 1rem;
    }
    .head > :global(:first-child) {
      grid-area: cover;
    }
    .head-main {
      display: contents;
    }
    .title-block {
      grid-area: title;
    }
    .title {
      font-size: 1.25rem;
    }
    .meta {
      margin: 0;
    }
    .head-tools {
      grid-area: modes;
      margin-top: 1rem;
    }
    .modes {
      flex: 1;
    }
    .mode {
      flex: 1;
      justify-content: center;
    }
    .fields:has(> .field) {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      row-gap: 0.875rem;
    }
    .tuning {
      grid-column: span 2;
      min-width: 0;
    }
    .key :global(input),
    .bpm input,
    .capo input {
      width: 100%;
    }
  }

  /* One column: the title and Details, the Lyric Sheet, then the Scrapbook,
     the Masters and Delete, all open. */
  .side {
    display: flex;
    flex-direction: column;
  }
  .scrapbook-part {
    margin-bottom: 2rem;
  }
  .delete {
    margin-top: 1rem;
  }
  .part > summary {
    display: none;
  }

  /* Desktop: two columns sitting together on the left, with Delete beside
     the title. The Lyric Sheet takes its width first; the side column grows
     into what's left, up to about a Section's width, and any spare width
     goes to the right. The side column starts level with the Lyric Sheet,
     sticks, scrolls on its own and stops above the docked Timeline. */
  @media (min-width: 80rem) {
    .song {
      display: grid;
      grid-template-columns:
        minmax(0, 55rem)
        clamp(var(--side-width), 100% - 55rem - var(--gutter), var(--side-max-width));
      grid-template-rows: auto 1fr;
      grid-template-areas:
        'top delete'
        'sheet side';
      justify-content: start;
      align-items: start;
      column-gap: var(--gutter);
    }
    .top {
      grid-area: top;
    }
    .sheet {
      grid-area: sheet;
    }
    .side {
      grid-area: side;
      position: sticky;
      top: var(--gutter);
      gap: 0.5rem;
      max-height: calc(100dvh - var(--timeline-height) - 2 * var(--gutter));
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .side > * {
      flex: none;
    }
    .scrapbook-part {
      margin-bottom: 0;
    }
    .delete {
      grid-area: delete;
      justify-self: end;
      margin-top: 0;
    }
    .title {
      min-height: 2.5rem;
      font-size: 1.25rem;
    }
    .part {
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      background: var(--surface-1);
    }
    .part[open] {
      padding: 0 0.75rem 0.75rem;
    }
    .part > summary {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-height: var(--control);
      padding: 0 0.75rem;
      font-weight: 700;
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    .part[open] > summary {
      margin: 0 -0.75rem 0.25rem;
    }
    /* A Lyric Sheet Section dragged over the Scrapbook would drop into it. */
    .part.drop-target {
      outline: 3px solid var(--accent);
      outline-offset: -3px;
    }
    .part > summary::-webkit-details-marker {
      display: none;
    }
    .part > summary::before {
      content: '›';
      width: 0.75rem;
      color: var(--text-muted);
      transition: transform 0.15s;
    }
    .part[open] > summary::before {
      transform: rotate(90deg);
    }
    .part > summary:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
      border-radius: 0.5rem;
    }
    /* The toggle names each section, so their own headings go. */
    .part :global(:is(#masters-heading, #scrapbook-heading)) {
      display: none;
    }
    /* The section's box draws the edges. */
    .part > :global(section) {
      margin: 0;
      padding: 0;
      border: 0;
    }
  }
</style>
