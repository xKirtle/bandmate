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
// It saves an Alternate's text as typed into its text box (see TextBox),
// and holds the Lyric Sheet's edits not saved yet: Lines text, and a
// Section's Label or an Alternate's name being typed. Saves sees them
// through what the Song page gives it.
import { SvelteMap } from 'svelte/reactivity';
import type { Song } from './api';
import type { LyricSheetChange } from './lyricSheetChanges';
import type { Saves, Typing } from './saves.svelte';

/** How long typing has to pause before an Alternate's text is saved, in milliseconds. */
export const saveDelay = 800;

export class LyricSheetEditing {
  #saves: Saves;
  #endSyncMode: () => void;
  /** The editors holding edits not saved yet, each with the Section it edits. */
  #unsaved = new SvelteMap<object, number>();
  /** How many edits have been typed into each Section's editor. */
  #typed = new SvelteMap<number, number>();

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
    for (const [editor, sectionId] of this.#unsaved) {
      if (editor instanceof TextBox && remakes(change, sectionId)) editor.saveNow();
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

  /** Whether the Lyric Sheet holds edits not saved yet. */
  get unsaved(): boolean {
    return this.#unsaved.size > 0;
  }

  /** Whether a Section's editor holds edits not saved yet: its Label, an Alternate's name, or its Lines' text. */
  unsavedIn(sectionId: number): boolean {
    for (const s of this.#unsaved.values()) if (s === sectionId) return true;
    return false;
  }

  /** How many edits have been typed into a Section's editor, e.g. to tell when typing carries on. */
  typedIn(sectionId: number): number {
    return this.#typed.get(sectionId) ?? 0;
  }

  /**
   * Hears a Section's Label or an Alternate's name being typed into its
   * editor, not saved yet, or no longer: they save on change, just before
   * they blur.
   */
  nameTyped(editor: object, sectionId: number, unsaved: boolean) {
    this.#report(editor, sectionId, unsaved);
  }

  /** Puts an edit being typed into the Lyric Sheet, e.g. a Cue's time, on Saves' list (see Saves.typing). */
  typing = (entry: Typing): (() => void) => this.#saves.typing(entry);

  /** The text box of an Alternate's Lines, in a Section's editor. Saves always go to that Alternate. */
  textBox(alternateId: number, sectionId: number): TextBox {
    return new TextBox(
      () => this.#saves.song,
      (text) => this.change({ kind: 'replaceAlternateText', alternateId, text }),
      (editor, unsaved) => this.#report(editor, sectionId, unsaved),
      alternateId,
    );
  }

  #report(editor: object, sectionId: number, unsaved: boolean) {
    if (unsaved) {
      this.#unsaved.set(editor, sectionId);
      this.#typed.set(sectionId, this.typedIn(sectionId) + 1);
    } else this.#unsaved.delete(editor);
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
 * Whether a change makes a Section's Alternates anew, so text sent to them
 * after it would be lost: adding the Section to another. (Moving an
 * Alternate out makes it anew too, but only an inactive one, which has no
 * text box.)
 */
function remakes(change: LyricSheetChange, sectionId: number): boolean {
  return change.kind === 'addToSection' && change.sectionId === sectionId;
}

/**
 * An Alternate's text as its text box shows it. What's typed is saved
 * once typing pauses, on blur, and as the box closes. While the box is
 * focused, or holds text waiting, on its way or failed to save, it keeps
 * its own text over the server's. A failed save isn't tried again until
 * the next keystroke or blur.
 */
export class TextBox {
  #song: () => Song;
  #send: (text: string) => Promise<boolean>;
  #report: (box: TextBox, unsaved: boolean) => void;
  #alternateId: number;

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

  constructor(
    song: () => Song,
    send: (text: string) => Promise<boolean>,
    report: (box: TextBox, unsaved: boolean) => void,
    alternateId: number,
  ) {
    this.#song = song;
    this.#send = send;
    this.#report = report;
    this.#alternateId = alternateId;
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
    this.#report(this, true);
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
    this.#report(this, false);
    if (!this.#focused) this.#own = null;
  }
}
