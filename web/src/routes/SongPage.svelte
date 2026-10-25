<script lang="ts">
  import History from '@lucide/svelte/icons/history';
  import Keyboard from '@lucide/svelte/icons/keyboard';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import { onDestroy, tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { api, commonKeys, type Song, type Status } from '../lib/api';
  import Combobox from '../lib/Combobox.svelte';
  import FoldChevron from '../lib/FoldChevron.svelte';
  import LyricSheet from '../lib/LyricSheet.svelte';
  import Masters from '../lib/Masters.svelte';
  import Scrapbook from '../lib/Scrapbook.svelte';
  import { dropsOnScrapbook } from '../lib/sectionDrag';
  import { SheetNotice } from '../lib/sheetNotice.svelte';
  import { SectionDragging } from '../lib/sectionDragging.svelte';
  import EditCover from '../lib/EditCover.svelte';
  import SongCover from '../lib/SongCover.svelte';
  import StatusBadge from '../lib/StatusBadge.svelte';
  import TagChips from '../lib/TagChips.svelte';
  import TagsField from '../lib/TagsField.svelte';
  import Timeline from '../lib/Timeline.svelte';
  import Toasts from '../lib/Toasts.svelte';
  import TuningField from '../lib/TuningField.svelte';
  import LanguagesField from '../lib/LanguagesField.svelte';
  import { LyricSheetEditing } from '../lib/lyricSheetEditing.svelte';
  import { Saves, type Undone } from '../lib/saves.svelte';
  import { SongUndo } from '../lib/songUndo.svelte';
  import { scrollBehavior } from '../lib/motion';
  import { detailFields, type DetailFields } from '../lib/songFields';
  import { cancelOnEscape, committedAsItGoes, leaveOnEscape } from '../lib/typedField.svelte';
  import { SyncMode } from '../lib/syncMode.svelte';
  import { RhymeMode } from '../lib/rhymeMode.svelte';
  import { songServer } from '../lib/songServer';
  import { takeNewFlag } from '../lib/newSong';
  import { navigate, replaceSearch, router } from '../lib/router.svelte';
  import { keyboardAndMouse, keyHints } from '../lib/keyHints';
  import { rebound } from '../lib/shortcutKeys';
  import { editHint, type Freeze } from '../lib/freeze';
  import ShortcutsDialog from '../lib/ShortcutsDialog.svelte';
  import SnapshotsDialog from '../lib/SnapshotsDialog.svelte';
  import { inTextField } from '../lib/textField';
  import { opensShortcuts, undoKey } from '../lib/songKeys';
  import { detailsSummary, openingMode, sideParts, type Mode, type SidePart } from '../lib/songMode';
  import { chordsInRead } from '../lib/chordChart';
  import { songChordsShown } from '../lib/chordsShown';
  import { songTranspose } from '../lib/sharedTranspose.svelte';
  import { rhymingDictionaries } from '../lib/sharedRhymingDictionaries.svelte';
  import { lyricsLanguage, type CaretListener } from '../lib/lyricsLanguage';
  import { lookUpRhymes } from '../lib/rhymeLookup';
  import RhymesCard from '../lib/RhymesCard.svelte';
  import { timeAgo } from '../lib/time';

  let { id }: { id: number } = $props();

  // A Song just made with "New Song" opens with its title focused and
  // selected, ready to type over, just this once: the flag saying so comes
  // out of the URL straight away, so a reload or Back/Forward doesn't.
  const { isNew, rest: queryWithoutFlag } = takeNewFlag(router.search);
  if (isNew) replaceSearch(queryWithoutFlag);
  let titleAwaitsFocus = isNew;

  // Every save the page and its panels make goes through Saves, made once
  // the Song's loaded.
  let saves = $state<Saves | null>(null);
  // The Song's Undo and Redo, in the header and on their keys, made with
  // Saves: see songUndo.svelte.ts.
  let songUndo = $state<SongUndo | null>(null);
  // Every change to the Lyric Sheet goes through Lyric Sheet editing, on top
  // of Saves, which ends Sync mode as the lyrics change.
  let editing = $state<LyricSheetEditing | null>(null);
  // The Details, each typed in place and saved on its own (see songFields.ts).
  let details = $state.raw<DetailFields | null>(null);
  // The Song as last saved. What's shown has the Cue changes not saved yet
  // made on top of it.
  const savedSong = $derived(saves?.savedSong ?? null);
  const shown = $derived(saves?.song ?? null);
  const savedTimeline = $derived(saves?.savedTimeline ?? null);
  // Where the Timeline is playing, in seconds; null while it isn't.
  let playhead = $state<number | null>(null);
  let timelinePanel = $state<Timeline>();
  // Whether the Timeline is recording, from pressing Record until the Take
  // is saved. Meanwhile no Master plays, the Song can't be deleted, leaving
  // asks first, and changes made elsewhere wait to be shown (the Timeline's
  // recorder holds Saves' refreshes).
  let recording = $state(false);
  // Undo and Redo, in the header and on their keys, are the Song's: they
  // reverse its latest edit, in either mode and on a phone too, even one
  // that can't be made there now. They're off entirely while a recording or
  // a Merge keeps the Song as it is, as the Timeline says.
  let freeze = $state<Freeze>(null);
  // A Status picked, shown until its save ends. With the Languages below,
  // it's one of the five As shown layers, each falling back to what's saved
  // its own way (see lib/saves.svelte.ts).
  let statusSent = $state<Status | null>(null);
  const status = $derived(statusSent ?? savedSong?.status ?? 'idea');
  // The Languages picked, shown until their save ends.
  let languagesSent = $state<string[] | null>(null);
  const languages = $derived(languagesSent ?? savedSong?.languages ?? []);
  const title = $derived(details?.title.shown ?? '');
  let loadError = $state<string | null>(null);
  let deleting = $state(false);
  // Read mode offers no editing anywhere on the page but the Timeline. It's
  // never saved: each visit starts from the Song's Status.
  let mode = $state<Mode>('write');
  const writing = $derived(mode === 'write');
  // Sync mode, which the Lyric Sheet draws and the Timeline attaches its
  // Loop, recording, Clips and playhead to: see syncMode.svelte.ts. Like
  // editing Cues, it's only on wider screens.
  const wide = new MediaQuery('min-width: 40.0625rem');
  const syncMode = new SyncMode({
    mode: () => mode,
    wide: () => wide.current,
    song: () => shown,
    cue: (change, what) => saves?.cue(change, what) ?? Promise.resolve(false),
  });
  // How far Read mode shows the Chords transposed: by the Lyric Sheet's
  // amount while they show, and not at all while they're hidden or Read mode
  // shows none, e.g. when only the Scrapbook has Chords.
  const transpose = $derived(
    savedSong && chordsInRead(savedSong) === 'shown' && songChordsShown.of(id) ? songTranspose.of(id) : 0,
  );
  // Rhyme mode, which the Lyric Sheet draws the toggle of: see
  // rhymeMode.svelte.ts. Like the side column, it's only on a desktop-wide
  // window, and Sync mode and it are never on together.
  const desktop = new MediaQuery('min-width: 80rem');
  const rhymeMode = new RhymeMode({ mode: () => mode, wide: () => desktop.current, sync: syncMode });
  // Rhymes, while Rhyme mode is on, worked out here from the dictionaries of
  // the Song's Languages downloaded to this device: only then are they read in,
  // once for as long as the page is open, and nothing is downloaded for a
  // Language that isn't downloaded. The card's are for the word at the caret of
  // the Line that has focus, kept once the caret leaves, or for one typed
  // into it, until the caret moves in a Line again. They're in the Language
  // the word is read in, or in another of the Song's Languages picked for it.
  $effect(() => {
    if (rhymeMode.on) rhymingDictionaries.use(languages);
  });
  const lyrics = $derived(lyricsLanguage(rhymingDictionaries.loaded));
  let cardWord = $state<string | null>(null);
  let cardLanguage = $state<string | null>(null);
  function setCardWord(word: string | null) {
    if (word !== cardWord) cardLanguage = null;
    cardWord = word;
  }
  const heardCaret: CaretListener = (at) => {
    const word = at && lyrics.wordAt(at.text, at.caret);
    if (word) setCardWord(word);
  };
  const onCaret = $derived(rhymeMode.on ? heardCaret : undefined);
  const cardRhymes = $derived(
    lookUpRhymes(
      lyrics,
      rhymeMode.on ? cardWord : null,
      languages,
      cardLanguage,
      rhymingDictionaries.loading(languages),
    ),
  );
  // The Details as Read mode shows them, with the key the Chords are shown in.
  const summary = $derived(
    details
      ? detailsSummary(
          { key: details.key.shown, bpm: details.bpm.shown, capo: details.capo.shown, tuning: details.tuning.shown },
          transpose,
        )
      : '',
  );
  const notes = $derived(details?.notes.shown ?? '');
  const hasNotes = $derived(notes.trim() !== '');

  // The Song's Tags as shown: changed at once, and saved one change after
  // another, each sending the whole list. Every Tag's name, to suggest.
  let tags = $state<string[]>([]);
  let knownTags = $state<string[]>([]);
  // Counts the changes to the Tags, so a save shows its Tags only if none came after.
  let tagChanges = 0;

  // Whether the Notes under the Details are showing. They start hidden.
  let notesOpen = $state(false);

  // Desktop puts the Scrapbook and Masters in a column beside the Lyric
  // Sheet, as sections that open and close, each as sideParts starts it on
  // each visit until it's toggled, with the Rhymes card in Rhyme mode; in
  // Write mode the Scrapbook and Masters are tabs of one card instead (see
  // sideTabs). Narrower windows show the Scrapbook and Masters after the Lyric Sheet,
  // always open. Keyed by name, switching moves them rather than rebuilding
  // them.
  const parts = $derived(
    sideParts(mode, { rhymes: rhymeMode.on }).filter(({ part }) => !sideTabs || part === 'rhymes'),
  );

  // On desktop in Write mode, the Scrapbook and the Masters share one card,
  // a tab each, rather than two that fold. A Section dragged over the card
  // shows the Scrapbook, where it would drop.
  const sideTabs = $derived(desktop.current && writing);
  let sideTab = $state<'scrapbook' | 'masters'>('scrapbook');
  let sideTabButtons = $state<HTMLButtonElement[]>([]);
  const sideTabOrder = ['scrapbook', 'masters'] as const;
  $effect(() => {
    if (sideTabs && dropsOnScrapbook(drag.drop)) sideTab = 'scrapbook';
  });

  function sideTabKey(e: KeyboardEvent, i: number) {
    const last = sideTabOrder.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: i === last ? 0 : i + 1,
      ArrowLeft: i === 0 ? last : i - 1,
      Home: 0,
      End: last,
    };
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    sideTab = sideTabOrder[to];
    sideTabButtons[to]?.focus();
  }
  // Parts opened or closed by hand, per mode.
  let toggledParts = $state<Partial<Record<`${Mode}-${SidePart}`, boolean>>>({});
  // The Rhymes card is open each time Rhyme mode comes on, however it was left.
  $effect(() => {
    if (!rhymeMode.on) untrack(() => delete toggledParts['write-rhymes']);
  });

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
    () => (savedSong ? `${savedSong.arrangement}|${savedSong.scrapbook}` : ''),
  );
  // What the Lyric Sheet says about a Section just moved: the Lyric Sheet
  // shows it, and a Section moved out of the Scrapbook says it there too.
  const notice = new SheetNotice();
  // The shortcuts dialog, opened by its button or ?. Shortcuts are for a
  // keyboard and mouse, so the button never shows on a phone or a narrow
  // window, though ? still opens the dialog there.
  let showingShortcuts = $state(false);
  // The Snapshots dialog, opened from Write mode only.
  let showingSnapshots = $state(false);
  const hints = keyHints();
  // Every Shortcut's keys, as rebound on this device, for the buttons' hints.
  const shortcuts = $derived(rebound());

  function keydown(event: KeyboardEvent) {
    if (!savedSong) return;
    if (opensShortcuts(event)) {
      event.preventDefault();
      showingShortcuts = true;
      return;
    }
    const undoing = undoKey(event);
    if (!undoing || !songUndo) return;
    event.preventDefault();
    if (undoing === 'undo') songUndo.undo();
    else songUndo.redo();
  }

  // Undo and Redo leave the text field being typed in first (see songUndo.svelte.ts).
  function leaveTextField() {
    const field = document.activeElement;
    if (field instanceof HTMLElement && inTextField(field)) field.blur();
  }

  // The page follows what an undo or a redo did, as the Timeline does. A
  // Lyric Sheet change undone or redone ends Sync mode, as any change to
  // the lyrics does, and shows the Section it changed, opening the
  // Scrapbook's fold for one there, without moving focus.
  $effect(() => songUndo?.follow((undone) => void showUndone(undone)));

  async function showUndone(undone: Undone) {
    if (undone.section === undefined) return;
    syncMode.end();
    const sectionId = undone.section;
    if (sectionId === null || !savedSong) return;
    if (savedSong.scrapbook.includes(sectionId) && sideTabs) sideTab = 'scrapbook';
    await tick();
    document
      .querySelector(`[data-section="${sectionId}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  }

  // How tall the docked Timeline is, which the side column stops above.
  let timelineHeight = $state(0);
  // How tall the toast stack is, which Auto-scroll's pill floats above.
  let toastsHeight = $state(0);

  $effect(() => {
    const server = songServer(id);
    Promise.all([server.getSong(), server.getTimeline()]).then(
      ([s, tl]) => {
        saves = new Saves({ server, song: s, timeline: tl, onReplace });
        songUndo = new SongUndo({ saves, freeze: () => freeze, leaveField: leaveTextField });
        editing = new LyricSheetEditing(saves, () => syncMode.end());
        details = detailFields(saves, api.updateSong);
        tags = s.tags;
        mode = openingMode(s.status);
      },
      (e: Error) => (loadError = e.message),
    );
    // Without suggestions, Tags can still be typed.
    api.listTags().then(
      (list) => (knownTags = list.map((t) => t.name)),
      () => {},
    );
  });

  // Tagging leaves the Song's version as it was, so it's never stale; it's
  // queued with the other saves only so they land in order. A failed save
  // shows the Tags as they were.
  async function setTags(next: string[]) {
    if (!saves) return;
    tags = next;
    const change = ++tagChanges;
    const saved = await saves.setTags(next);
    if (saved) {
      // As saved: in order, and spelled as the Tags matched are, unless
      // changed again meanwhile.
      if (change === tagChanges) tags = saved;
      knownTags = [...new Set([...knownTags, ...saved])];
    } else if (change === tagChanges && savedSong) tags = savedSong.tags;
  }

  // Coming back to the tab shows what changed meanwhile, e.g. on another
  // device (see Saves.refresh).
  function refreshOnReturn() {
    if (document.visibilityState === 'visible') saves?.refresh();
  }

  // A refresh is about to show the Song as changed elsewhere. Nothing is
  // unsaved, so a Detail typed back to what's saved is let go, to show the
  // change, and leaving a focused field saves nothing.
  function onReplace(latest: Song) {
    for (const field of detailList()) field.cancel();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    tags = latest.tags;
  }

  function detailList() {
    return details ? Object.values(details) : [];
  }

  // Set while reloading on purpose, so leaving doesn't ask again.
  let reloading = false;

  function reload() {
    if (saves?.unsaved && !confirm('Reload the Song? Edits that weren’t saved here will be lost.')) return;
    reloading = true;
    location.reload();
  }

  /** Sets the BPM, e.g. copied from a Beat when asked to. */
  function setBpm(bpm: number) {
    if (!details) return;
    details.bpm.shown = String(bpm);
    details.bpm.commit();
  }

  async function setStatus(next: Status) {
    if (!saves) return;
    statusSent = next;
    await saves.submit((at) => api.updateSong(at, { status: next }));
    if (statusSent === next) statusSent = null;
  }

  async function setLanguages(next: string[]) {
    if (!saves) return;
    languagesSent = next;
    await saves.submit((at) => api.updateSong(at, { languages: next }));
    if (languagesSent === next) languagesSent = null;
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
      void title;
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

  // A title is one line: Enter saves it, Esc takes it back, and a pasted
  // line break is a space.
  function oneLine(event: Event & { currentTarget: HTMLTextAreaElement }) {
    if (details && /[\r\n]/.test(event.currentTarget.value))
      details.title.shown = event.currentTarget.value.replace(/\s*[\r\n]+\s*/g, ' ');
  }

  function titleKey(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') details?.title.cancel();
  }

  // Inputs save on change, which fires on blur, and as they go (see
  // committedAsItGoes). Whatever is still typed as the page goes is saved
  // too, e.g. a tuning picked.
  onDestroy(() => {
    for (const field of detailList()) field.destroy();
  });

  // Closing or reloading the tab can't wait for a save, or a recording, so ask first.
  function warnBeforeUnload(event: BeforeUnloadEvent) {
    if (!reloading && (recording || saves?.unsaved)) event.preventDefault();
  }

  async function remove() {
    if (!saves || !savedSong || recording) return;
    const ok = confirm(
      `Delete “${savedSong.title}”?\n\nThis removes the Song and everything in it. It can't be undone.`,
    );
    if (!ok) return;
    deleting = true;
    if (await saves.close((at) => api.deleteSong(at))) navigate('/', { replace: true });
    else deleting = false;
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

<svelte:window onbeforeunload={warnBeforeUnload} onkeydown={keydown} />
<svelte:document onvisibilitychange={refreshOnReturn} />

<main class="page" style:--timeline-height="{timelineHeight}px" style:--toasts-height="{toastsHeight}px">
  {#if loadError}
    <p class="error" role="alert">{loadError}</p>
  {:else if !saves || !savedSong || !editing || !details}
    <p class="muted">Loading…</p>
  {:else}
    <div class="song">
      <div class="top">
        <div class="head">
          {#if writing}
            <EditCover
              songId={savedSong.id}
              cover={savedSong.cover}
              {title}
              {status}
              change={saves.change}
              onError={saves.report}
            />
          {:else}
            <SongCover songId={savedSong.id} coverId={savedSong.cover?.id ?? null} {title} {status} size="header" />
          {/if}
          <div class="head-main">
            <div class="title-block">
              {#if writing}
                <label class="visually-hidden" for="song-title">Title</label>
                <textarea
                  id="song-title"
                  class="title"
                  rows="1"
                  bind:value={details.title.shown}
                  {@attach fitTitle}
                  {@attach focusNewTitle}
                  {@attach committedAsItGoes(details.title)}
                  oninput={oneLine}
                  onkeydown={titleKey}
                  onchange={() => details?.title.commit()}
                  required
                  autocomplete="off"
                  enterkeyhint="done"></textarea>
              {:else}
                <h1 class="title">{title}</h1>
              {/if}
              <div class="meta">
                <StatusBadge {status} onChange={writing ? setStatus : undefined} />
                <span class="muted" aria-hidden="true">·</span>
                <p class="save-state muted" role="status">
                  {#if saves.pending > 0}
                    Saving…
                  {:else}
                    Edited <time datetime={savedSong.updatedAt}>{timeAgo(savedSong.updatedAt)}</time>
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
              <button
                type="button"
                class="button tool"
                onclick={() => songUndo?.undo()}
                disabled={!songUndo?.undoes}
                aria-label="Undo"
                aria-keyshortcuts={hints.aria(shortcuts.undo.keys)}
                title={editHint(freeze, hints.withKeys('Undo', shortcuts.undo.keys))}
              >
                <Undo2 />
              </button>
              <button
                type="button"
                class="button tool"
                onclick={() => songUndo?.redo()}
                disabled={!songUndo?.redoes}
                aria-label="Redo"
                aria-keyshortcuts={hints.aria(shortcuts.redo.keys)}
                title={editHint(freeze, hints.withKeys('Redo', shortcuts.redo.keys))}
              >
                <Redo2 />
              </button>
              {#if writing}
                <button
                  type="button"
                  class="button tool"
                  onclick={() => (showingSnapshots = true)}
                  aria-label="Snapshots"
                  aria-haspopup="dialog"
                  title="Snapshots"
                >
                  <History />
                </button>
              {/if}
              {#if keyboardAndMouse()}
                <button
                  type="button"
                  class="button tool"
                  onclick={() => (showingShortcuts = true)}
                  aria-label="Keyboard shortcuts"
                  aria-haspopup="dialog"
                  aria-keyshortcuts={hints.aria(shortcuts.showShortcuts.keys)}
                  title={hints.withKeys('Keyboard shortcuts', shortcuts.showShortcuts.keys)}
                >
                  <Keyboard />
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
                  bind:value={details.key.shown}
                  {@attach committedAsItGoes(details.key)}
                  options={commonKeys}
                  saved={savedSong.key}
                  onpick={() => details?.key.commit()}
                  onchange={() => details?.key.commit()}
                  onrevert={() => details?.key.cancel()}
                  autocomplete="off"
                  autocapitalize="characters"
                  enterkeyhint="done"
                  placeholder="—"
                />
              </label>
              <label class="field bpm">
                BPM
                <input
                  bind:value={details.bpm.shown}
                  {@attach committedAsItGoes(details.bpm)}
                  onchange={() => details?.bpm.commit()}
                  onkeydown={cancelOnEscape(details.bpm)}
                  inputmode="numeric"
                  autocomplete="off"
                  enterkeyhint="done"
                  placeholder="—"
                />
              </label>
              <label class="field capo">
                Capo
                <input
                  bind:value={details.capo.shown}
                  {@attach committedAsItGoes(details.capo)}
                  onchange={() => details?.capo.commit()}
                  onkeydown={cancelOnEscape(details.capo)}
                  inputmode="numeric"
                  autocomplete="off"
                  enterkeyhint="done"
                  placeholder="—"
                />
              </label>
              <div class="field tuning">
                <span id="song-tuning-label">Tuning</span>
                <TuningField
                  id="song-tuning"
                  labelledby="song-tuning-label"
                  bind:value={details.tuning.shown}
                  oncommit={() => details?.tuning.commit()}
                  oninvalid={saves.report}
                  customNotes={details.customTuning}
                />
              </div>
              <div class="field languages">
                <span id="song-languages-label">Languages</span>
                <LanguagesField
                  id="song-languages"
                  labelledby="song-languages-label"
                  value={languages}
                  onchange={setLanguages}
                />
              </div>
              {@render notesToggle()}
            </div>
            <div class="field tags">
              <span id="song-tags-label">Tags</span>
              <TagsField id="song-tags" labelledby="song-tags-label" {tags} known={knownTags} onchange={setTags} />
            </div>
            {#if notesOpen}
              <label class="notes">
                <span class="visually-hidden">Notes</span>
                <textarea
                  id="song-notes"
                  bind:value={details.notes.shown}
                  {@attach committedAsItGoes(details.notes)}
                  onchange={() => details?.notes.commit()}
                  onkeydown={leaveOnEscape(details.notes)}
                  rows="4"></textarea>
              </label>
            {/if}
          {:else}
            <div class="fields">
              <p class="summary" class:muted={!summary}>{summary || 'No Details yet.'}</p>
              {#if hasNotes}{@render notesToggle()}{/if}
            </div>
            {#if tags.length > 0}
              <div class="read-tags"><TagChips {tags} /></div>
            {/if}
            {#if notesOpen && hasNotes}
              <p id="song-notes" class="read-notes">{notes}</p>
            {/if}
          {/if}
        </section>

        {#if saves.stale}
          <div class="stale" role="alert">
            <p>
              This Song changed elsewhere, so edits made here since can’t be saved. Reload to see the latest. Edits that
              weren’t saved stay where you typed them until then, so copy out anything you want to keep.
            </p>
            <button type="button" class="button" onclick={reload}>Reload</button>
          </div>
        {/if}
        <!-- A refused save says so in the toast stack below, labelled with
             the surface its edit was made on, rather than in a line here,
             half a page from a Timeline or Lyric Sheet edit (ADR 0029). -->
      </div>

      <div class="sheet">
        <LyricSheet
          song={shown!}
          {mode}
          {drag}
          changeCues={saves.cue}
          {editing}
          {playhead}
          playFrom={(at) => timelinePanel?.playFrom(at)}
          {recording}
          {syncMode}
          {rhymeMode}
          {onCaret}
          {notice}
          hasClips={savedTimeline?.tracks.some((t) => t.clips.length > 0) ?? false}
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
              <summary><FoldChevron />{savedSong.masters.length > 1 ? 'Masters' : 'Master'}</summary>
              <Masters song={savedSong} {mode} submit={saves.submit} typing={saves.typing} {setStatus} {recording} />
            {:else if part === 'rhymes'}
              <summary><FoldChevron />Rhymes</summary>
              <RhymesCard
                lookup={cardRhymes}
                setWord={setCardWord}
                {languages}
                pickLanguage={(code) => (cardLanguage = code)}
              />
            {:else}
              <summary><FoldChevron />Scrapbook</summary>
              <Scrapbook song={savedSong} {drag} {editing} {onCaret} {notice} />
            {/if}
          </details>
        {/each}
        {#if sideTabs}
          <div
            class="part tabbed"
            class:drop-target={dropsOnScrapbook(drag.drop)}
            {@attach (el) => drag.placeScrapbook(el)}
          >
            <div class="tabs" role="tablist" aria-label="Scrapbook and Masters">
              {#each sideTabOrder as tab, i (tab)}
                <button
                  bind:this={sideTabButtons[i]}
                  id="side-tab-{tab}"
                  type="button"
                  role="tab"
                  aria-selected={sideTab === tab}
                  aria-controls="side-panel-{tab}"
                  tabindex={sideTab === tab ? 0 : -1}
                  onclick={() => (sideTab = tab)}
                  onkeydown={(e) => sideTabKey(e, i)}
                >
                  {tab === 'scrapbook' ? 'Scrapbook' : savedSong.masters.length > 1 ? 'Masters' : 'Master'}
                </button>
              {/each}
            </div>
            <div
              id="side-panel-scrapbook"
              role="tabpanel"
              aria-labelledby="side-tab-scrapbook"
              hidden={sideTab !== 'scrapbook'}
            >
              <Scrapbook song={savedSong} {drag} {editing} {onCaret} {notice} />
            </div>
            <div
              id="side-panel-masters"
              role="tabpanel"
              aria-labelledby="side-tab-masters"
              hidden={sideTab !== 'masters'}
            >
              <Masters song={savedSong} {mode} submit={saves.submit} typing={saves.typing} {setStatus} {recording} />
            </div>
          </div>
        {/if}
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

{#if saves && songUndo && shown && savedTimeline}
  <Timeline
    bind:this={timelinePanel}
    bind:height={timelineHeight}
    song={shown}
    {saves}
    {songUndo}
    {setBpm}
    onPlayhead={(at) => (playhead = at)}
    {syncMode}
    onRecording={(on) => (recording = on)}
    onFreeze={(f) => (freeze = f)}
  />
{/if}

<!-- Every save the page was refused, one toast per surface, over the page in
     the bottom corner of the window (see Toasts.svelte). -->
{#if saves}
  <Toasts {saves} dock={timelineHeight} bind:height={toastsHeight} />
{/if}

{#if showingShortcuts}
  <ShortcutsDialog onClose={() => (showingShortcuts = false)} />
{/if}

{#if showingSnapshots && editing && savedSong}
  {@const restoring = editing}
  <SnapshotsDialog
    songId={id}
    current={savedSong}
    restore={(snapshotId) => restoring.change({ kind: 'restoreSnapshot', snapshotId })}
    onClose={() => (showingSnapshots = false)}
  />
{/if}

<style>
  /* The title and its heading wrap alike and are as tall as each other,
     one line being --title-line, so switching mode doesn't shift the page. */
  .title {
    --title-line: 3rem;
    display: block;
    min-height: var(--title-line);
    margin: 0 0 var(--space-1);
    padding: calc((var(--title-line) - 1lh) / 2 - 1px) var(--space-2);
    margin-left: calc(-1 * var(--space-2));
    width: calc(100% + var(--space-2));
    border-color: transparent;
    background: transparent;
    font-size: var(--text-2xl);
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
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }
  .head-main {
    display: flex;
    flex: 1;
    align-items: flex-start;
    gap: var(--space-3);
    min-width: 0;
  }
  .title-block {
    flex: 1;
    min-width: 0;
  }
  /* The mode switch, then Undo and Redo, the Snapshots and shortcuts buttons. */
  .head-tools {
    display: flex;
    flex: none;
    gap: var(--space-2);
  }
  .tool {
    width: var(--control);
    padding: 0;
    font-size: var(--text-xl);
  }
  .modes {
    display: flex;
    flex: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .mode {
    display: flex;
    align-items: center;
    min-height: var(--control);
    padding: 0 var(--space-4);
    background: var(--surface-1);
    font-weight: 600;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease);
  }
  /* The mode not chosen rises halfway to the chosen one's surface under a
     pointer that can hover, so it never looks chosen. */
  @media (hover: hover) {
    .mode:hover:not(:has(input:checked, input:disabled)) {
      background: color-mix(in srgb, var(--surface-2) 50%, var(--surface-1));
    }
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
    gap: 0 var(--space-2);
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
  }
  .save-state {
    margin: 0;
  }
  .error {
    margin-bottom: var(--space-4);
  }
  .stale {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
  }
  .stale p {
    flex: 1 1 16rem;
    margin: 0;
  }
  /* The Details: small labelled fields in a row that wraps, the Notes
     toggle last. */
  .details {
    margin: 0 0 var(--space-3);
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2) var(--space-3);
  }
  /* The Details' labels are a step smaller than a field's usual one. */
  .field {
    font-size: var(--text-xs);
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
  /* Grows to fit a custom tuning's notes beside the picker. */
  .tuning {
    flex: 0 1 auto;
    min-width: 6rem;
  }
  /* Room for a Language's name beside the ▾, growing to fit several. */
  .languages {
    flex: 0 1 auto;
    min-width: 7rem;
  }
  .notes-toggle {
    gap: var(--space-2);
  }
  /* A dot says there are Notes behind the toggle. */
  .notes-toggle.has-notes::after {
    content: '';
    width: 0.375rem;
    height: 0.375rem;
    border-radius: var(--radius-full);
    background: var(--accent);
  }
  .notes {
    display: block;
    margin-top: var(--space-2);
  }
  /* The Tags on a row of their own under the other Details, as they're many. */
  .tags {
    display: flex;
    flex-direction: column;
    margin-top: var(--space-2);
  }
  .read-tags {
    margin-top: var(--space-2);
  }
  .notes textarea,
  .read-notes {
    line-height: var(--leading-content);
  }
  .summary,
  .read-notes {
    margin: 0;
  }
  .summary {
    font-size: var(--text-md);
    font-variant-numeric: tabular-nums;
  }
  .read-notes {
    margin-top: var(--space-2);
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
      gap: 0 var(--space-3);
      margin-bottom: var(--space-4);
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
      font-size: var(--text-xl);
    }
    .meta {
      margin: 0;
    }
    .head-tools {
      grid-area: modes;
      margin-top: var(--space-4);
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
      row-gap: var(--space-4);
    }
    .tuning {
      grid-column: span 2;
      min-width: 0;
    }
    /* Its grid column, not the row's minimum, sets its width: a phone's
       third of the row is narrower than that, and it would overflow it. */
    .languages {
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
    margin-bottom: var(--space-8);
  }
  .delete {
    margin-top: var(--space-4);
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
      gap: var(--space-2);
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
      font-size: var(--text-xl);
    }
    /* A card, as .card draws one, on desktop only. */
    .part {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface-1);
    }
    .part[open],
    .tabbed {
      padding: 0 var(--space-3) var(--space-3);
    }
    /* Its tabs sit where a card's toggle would. */
    .tabbed > .tabs {
      margin: 0 calc(-1 * var(--space-3)) var(--space-2);
      padding: 0 var(--space-1);
      border-bottom: 1px solid var(--border);
    }
    .part > summary {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--control);
      padding: 0 var(--space-3);
      font-weight: 700;
      cursor: pointer;
      user-select: none;
    }
    .part[open] > summary {
      margin: 0 calc(-1 * var(--space-3)) var(--space-1);
    }
    /* A Lyric Sheet Section dragged over the Scrapbook would drop into it. */
    .part.drop-target {
      outline: 3px solid var(--accent);
      outline-offset: -3px;
    }
    .part > summary:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
      border-radius: var(--radius-md);
    }
    /* The toggle names each section, so their own headings go. */
    .part :global(:is(#masters-heading, #scrapbook-heading)) {
      display: none;
    }
    /* The section's box draws the edges. */
    .part > :global(section),
    .tabbed > [role='tabpanel'] > :global(section) {
      margin: 0;
      padding: 0;
      border: 0;
    }
  }
</style>
