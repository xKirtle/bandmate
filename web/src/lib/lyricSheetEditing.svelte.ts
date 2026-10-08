// Lyric Sheet editing: the changes the Lyric Sheet, its Section editors and
// the Scrapbook make, made once per Song by the Song page on top of Saves
// and handed to them. Each change is named by its kind (see
// lyricSheetChanges.ts) and sent through Saves, in the order asked for.
//
// It keeps the Lyric Sheet's editing rules:
// - Sync mode is only for cueing, so changing the lyrics ends it, playback
//   carrying on (see the GLOSSARY): every change but deleting a Section in
//   the Scrapbook, which isn't in the Lyric Sheet, and saving Lines text,
//   which may still be on its way as Sync mode comes on. Opening a Section
//   in the Scrapbook, or a Section's Alternates, ends it too. Cue changes
//   don't go through here, so never end it.
// - Adding a Section to another makes its Alternates anew, so the Lines
//   text still waiting in their text boxes is sent first, while it can
//   still land on them.
//
// It makes a Section's Label and an Alternate's name fields typed in place
// (see typedField.svelte.ts), and saves an Alternate's text as typed into
// its text box (see TextBox). Each goes on Saves' list of edits being
// typed, with its Section, which answers whether a Section holds edits not
// saved yet, and how much has been typed into it.
import type { Song } from './api';
import type { LyricSheetChange } from './lyricSheetChanges';
import type { Saves, Typing } from './saves.svelte';
import { TypedField } from './typedField.svelte';

/** How long typing has to pause before an Alternate's text is saved, in milliseconds. */
export const saveDelay = 800;

export class LyricSheetEditing {
  #saves: Saves;
  #endSyncMode: () => void;

  /** Lyric Sheet editing through Saves, ending Sync mode with endSyncMode. */
  constructor(saves: Saves, endSyncMode: () => void) {
    this.#saves = saves;
    this.#endSyncMode = endSyncMode;
  }

  /**
   * Queues a change to the Lyric Sheet, ending Sync mode for it, and
   * sending first the Lines text waiting in Alternates it makes anew.
   * Resolves to whether it was saved; a caller's code up to its next await
   * runs before the next change starts.
   */
  change = (change: LyricSheetChange): Promise<boolean> => {
    if (endsSyncMode(change)) this.#endSyncMode();
    const remade = sectionRemadeBy(change);
    if (remade !== null) {
      for (const entry of this.#saves.typingIn(remade)) if (entry instanceof TextBox) entry.saveNow();
    }
    return this.#saves.changeLyricSheet(change);
  };

  /** Hears a Section in the Scrapbook being opened in its editor. */
  scrapbookSectionOpened() {
    this.#endSyncMode();
  }

  /** Hears a Section's Alternates being opened, to choose, make or rename them. */
  alternatesOpened() {
    this.#endSyncMode();
  }

  /**
   * Whether a Section's editor holds edits not saved yet: its Label, an
   * Alternate's name, its Lines' text or a Cue's time.
   */
  unsavedIn(sectionId: number): boolean {
    return this.#saves.typingIn(sectionId).some((t) => t.unsaved);
  }

  /** How many edits have been typed into a Section's editor, e.g. to tell when typing carries on. */
  typedIn(sectionId: number): number {
    return this.#saves.typedIn(sectionId);
  }

  /** Puts an edit being typed into the Lyric Sheet, e.g. a Cue's time, on Saves' list (see Saves.typing). */
  typing = (entry: Typing): (() => void) => this.#saves.typing(entry);

  /** A Section's Label, typed in place. It's saved trimmed; blank, the Section goes by its place. */
  sectionLabel(sectionId: number): TypedField<string> {
    return this.#trimmedField(
      sectionId,
      () => this.#saves.song.sections.find((s) => s.id === sectionId)?.label ?? '',
      (label) => ({ kind: 'setSectionLabel', sectionId, label }),
    );
  }

  /** An Alternate's name, typed in place, in a Section's editor. It's saved trimmed; blank removes it. */
  alternateName(alternateId: number, sectionId: number): TypedField<string> {
    return this.#trimmedField(
      sectionId,
      () => this.#saves.song.sections.flatMap((s) => s.alternates).find((a) => a.id === alternateId)?.name ?? '',
      (name) => ({ kind: 'renameAlternate', alternateId, name }),
    );
  }

  /** Text typed in place in a Section's editor, saved trimmed by the change it makes. */
  #trimmedField(sectionId: number, saved: () => string, change: (text: string) => LyricSheetChange) {
    return new TypedField<string>({
      saved,
      format: (text) => text,
      parse: (typed) => ({ value: typed.trim() }),
      commit: (text) => this.change(change(text)),
      typing: this.#saves.typing,
      section: sectionId,
    });
  }

  /** The text box of an Alternate's Lines, in a Section's editor. Saves always go to that Alternate. */
  textBox(alternateId: number, sectionId: number): TextBox {
    return new TextBox(
      () => this.#saves.song,
      (text) => this.change({ kind: 'replaceAlternateText', alternateId, text }),
      this.#saves.typing,
      alternateId,
      sectionId,
    );
  }
}

/**
 * Whether a change ends Sync mode: every change to the lyrics, but deleting
 * a Section in the Scrapbook and saving Lines text.
 */
function endsSyncMode(change: LyricSheetChange): boolean {
  return change.kind !== 'deleteSection' && change.kind !== 'replaceAlternateText';
}

/**
 * The Section whose Alternates a change makes anew, so text sent to them
 * after it would be lost: one added to another. (Moving an Alternate out
 * makes it anew too, but only an inactive one, which has no text box.)
 */
function sectionRemadeBy(change: LyricSheetChange): number | null {
  return change.kind === 'addToSection' ? change.sectionId : null;
}

/**
 * An Alternate's text as its text box shows it. What's typed is saved
 * once typing pauses, on blur, and as the box closes. While the box is
 * focused, or holds text waiting, on its way or failed to save, it keeps
 * its own text over the server's. A failed save isn't tried again until
 * the next keystroke or blur.
 *
 * Typed in, it goes on Saves' list of edits being typed, with its Section,
 * until it's closed and its last save is over. It's unsaved from a
 * keystroke until nothing is waiting, on its way or, while it's open,
 * failed.
 */
export class TextBox implements Typing {
  #song: () => Song;
  #send: (text: string) => Promise<boolean>;
  #typing: (entry: Typing) => () => void;
  #alternateId: number;
  readonly section: number;

  /** The text as saved, or none once the Alternate's gone. */
  #saved = $derived(this.#savedText());
  /** The box's own text, shown while it holds it; null shows the server's. */
  #own = $state<string | null>(null);
  /** The last text sent to or shown from the server, while the box holds its own. */
  #sent = '';
  #focused = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #inFlight = 0;
  /** The last save failed, so the box holds edits the server doesn't have. */
  #failed = false;
  /** The box has gone: once its last save is over, it holds nothing unsaved. */
  #closed = false;
  #unsaved = $state(false);
  #edits = $state(0);
  /** Takes it off Saves' list: set once typed in, until it's closed and settled. */
  #leave: (() => void) | null = null;

  constructor(
    song: () => Song,
    send: (text: string) => Promise<boolean>,
    typing: (entry: Typing) => () => void,
    alternateId: number,
    section: number,
  ) {
    this.#song = song;
    this.#send = send;
    this.#typing = typing;
    this.#alternateId = alternateId;
    this.section = section;
  }

  /** Whether it holds text that isn't saved yet. */
  get unsaved(): boolean {
    return this.#unsaved;
  }

  /** How many edits have been typed into it, e.g. keystrokes. */
  get typed(): number {
    return this.#edits;
  }

  /** The text the box shows. */
  get text(): string {
    return this.#own ?? this.#saved;
  }

  #savedText(): string {
    for (const s of this.#song().sections) {
      const alternate = s.alternates.find((a) => a.id === this.#alternateId);
      if (alternate) return alternate.lines.map((l) => l.text).join('\n');
    }
    return '';
  }

  focus = () => {
    this.#focused = true;
    this.#hold();
  };

  /** Takes the text typed, saving it once typing pauses. */
  type = (text: string) => {
    this.#hold();
    this.#own = text;
    clearTimeout(this.#timer);
    this.#leave ??= this.#typing(this);
    this.#unsaved = true;
    this.#edits++;
    this.#timer = setTimeout(this.#save, saveDelay);
  };

  blur = () => {
    this.#focused = false;
    void this.#save();
  };

  /**
   * The box has gone, e.g. leaving the page, which doesn't blur it: saves
   * what's still waiting or failed last time.
   */
  close = () => {
    this.#closed = true;
    this.saveNow();
    this.#settle();
  };

  /** Saves at once what's waiting or failed last time, e.g. before its Alternate is made anew. */
  saveNow() {
    if (this.#timer !== undefined || this.#failed) void this.#save();
  }

  /** Keeps the box's own text from now on, starting from the server's. */
  #hold() {
    if (this.#own !== null) return;
    this.#own = this.#sent = this.#saved;
  }

  #save = async () => {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const text = this.#own;
    if (text !== null && (text !== this.#sent || this.#failed)) {
      const previous = this.#sent;
      this.#sent = text;
      this.#inFlight++;
      this.#failed = !(await this.#send(text));
      this.#inFlight--;
      if (this.#failed) this.#sent = previous;
    }
    this.#settle();
  };

  // Once nothing is waiting to be saved, show the server's text again,
  // unless the last save failed and the box is the only copy of the edits,
  // and it's still open.
  #settle() {
    if (this.#timer !== undefined || this.#inFlight > 0) return;
    if (this.#failed && !this.#closed) return;
    this.#unsaved = false;
    if (!this.#focused) this.#own = null;
    if (this.#closed) {
      this.#leave?.();
      this.#leave = null;
    }
  }
}
