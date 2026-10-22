// Saves: every save the Song page and its panels make, made once per Song
// by the Song page and handed to what saves.
//
// Saves run one turn at a time, in the order they were asked for, so they
// land in that order, each built against the Song and Timeline as saved
// when its turn comes. Nothing throws: a save refused because the Song
// changed elsewhere marks it stale; any other failure becomes the save
// error of the surface its edit was made on, which a later save landing on
// that surface clears (ADR 0029). Callers react to a save after awaiting
// its result: their code up to its next await runs before the next turn
// starts.
//
// Which surface an edit was made on is the method it arrives through, not
// anything a caller passes: submit, setTags and report are the Details,
// edit and make the Timeline, cue the Cues, changeLyricSheet the Lyric
// Sheet. An undo or a redo takes its surface from the kind of the edit it
// replays.
//
// A Cue change shows at once, made on top of the Song as saved (see
// cueChanges.ts), so syncing keeps its rhythm. Its save is tried again for
// a few seconds while it fails on the network or the server; if it still
// fails, it's taken back, as a whole.
//
// It keeps a list of the edits being typed, e.g. a Track's name typed in
// place (see typedField.svelte.ts) or an Alternate's text: while any
// differs from what's saved, the Song has unsaved edits, so closing the tab
// asks first and a refresh doesn't replace the Song. An edit typed into a
// Section carries it, so the list also says what's typed into each Section.
//
// Timeline edits, Cue changes and Lyric Sheet changes are kept to undo, in
// one history (see history.ts), in the order they were made. An undo waits
// for the edits queued before it. A save refused as the Song changed
// elsewhere, or a refresh bringing in a change made elsewhere, forgets them
// all. Undoing a Lyric Sheet change puts the whole sheet back, so every
// change to it has to be kept, or the history forgotten (ADR 0019); the
// changes one visit to a text field saves, one after another, are kept as
// one.
//
// The five As shown layers. The Song as shown is one term in the glossary,
// and the browser holds it in five places, each collapsing back to what's
// saved its own way, which is why they stay apart rather than becoming one
// layer that takes the policy as a parameter (ADR 0027):
//
// - The Cue changes, here: an ordered list of the changes not saved yet,
//   replayed in order over the Song as saved. One leaves the list as its
//   save lands, or is taken back whole if it fails.
// - Timeline editing (see timelineEditing.svelte.ts): a map keyed by field,
//   where the newest value for a field wins, dropped altogether once a
//   refresh has replaced the Song, with each fader's own bookkeeping of
//   what it started from and what showed under it.
// - A field typed in place (see typedField.svelte.ts): one string, what's
//   typed or what's saved formatted, which goes back to what's saved as its
//   save resolves, unless something was typed since.
// - A Clip dragged (see clipDrag.svelte.ts): the Clips held as they were
//   dropped until one particular save resolves, so it's scoped to that
//   save rather than to a field.
// - The Song page's Status and Languages (see routes/SongPage.svelte):
//   what was sent, or else what's saved, in two lines each.
//
// Names here say which layer they hold: song is the Song as shown, while
// savedSong and savedTimeline are the pair as saved.
import { ApiError, type Song, type Timeline } from './api';
import { sameCues, withCueChange, type CueChange } from './cueChanges';
import { History, restorable, type Edit, type HistoryEdit } from './history';
import { changedSection, type LyricSheetChange, type FieldVisit } from './lyricSheetChanges';
import { savedRetrying, waitFor, type SongServer, type Wait } from './songServer';

/** How a save ended: saved, failed, refused as the Song changed elsewhere, or never sent as the Song's being deleted. */
export type Submitted = 'saved' | 'failed' | 'stale' | 'closed';

/**
 * One of the Song page's four surfaces an edit can be made on, which a
 * refused save is remembered against (ADR 0029). The Scrapbook's Section
 * moves are the Lyric Sheet's, as they're the same change made elsewhere.
 */
export type Surface = 'details' | 'timeline' | 'cues' | 'lyricSheet';

/** What a Timeline edit did: the Timeline as saved before it, and the Timeline it left. */
export interface Edited {
  before: Timeline;
  after: Timeline;
}

/** What an undo or redo did, and what the Timeline goes back to with it. */
export interface Undone extends Edited {
  /**
   * The Clips to select again: undoing a paste, or Clips brought back
   * together, e.g. by undoing a Delete, a Merge or a Split, those selected
   * before it; redoing a Merge, its Clip, or a Split, its right halves.
   * Null to leave the Selection as it is.
   */
  reselect: number[] | null;
  /** Where to return the playhead to: where a new Take undone started. Null to leave it where it is. */
  playhead: number | null;
  /**
   * For a Lyric Sheet change undone or redone, the Section it changed, to
   * show, or null if none is left to; undefined for other edits.
   */
  section?: number | null;
}

/**
 * What a rarer edit, made with make, did: the Timeline it left, and how
 * it's kept to undo: as an edit that makes it again without uploading or
 * rendering anything again, or as a new Take.
 */
export interface Made {
  timeline: Timeline;
  kept: Edit | 'take';
}

/** An edit being typed, on Saves' list, e.g. a field typed in place (see typedField.svelte.ts). */
export interface Typing {
  /** Whether what's typed isn't saved yet. */
  readonly unsaved: boolean;
  /** How many edits have been typed into it, e.g. keystrokes. */
  readonly typed: number;
  /** The Section it's typed in, if any. */
  readonly section?: number;
  /**
   * Sends what's typed now, rather than when the field would, e.g. before
   * what it belongs to is made anew. Refused by the field's own rule, it
   * stays where it is, unsaved.
   */
  saveNow(): void;
}

export interface SavesOptions {
  /** The Song on the server. */
  server: SongServer;
  /** The Song and its Timeline, as loaded. */
  song: Song;
  timeline: Timeline;
  /** Waits between tries of a Cue change's save. */
  wait?: Wait;
  /**
   * Hears that a refresh is about to show the Song as changed elsewhere,
   * e.g. to show its Details in the inputs.
   */
  onReplace?: (song: Song) => void;
}

export class Saves {
  #server: SongServer;
  #wait: Wait;
  #onReplace: (song: Song) => void;

  #savedSong: Song = $state.raw()!;
  /** Cue changes not saved yet, in the order they were made. */
  #unsavedCues: { change: CueChange }[] = $state.raw([]);
  #shown = $derived(this.#unsavedCues.reduce((s, u) => withCueChange(s, u.change), this.#savedSong));
  /** The edits being typed, e.g. fields typed in place, unsaved while they differ from what's saved. */
  #typing: Typing[] = $state.raw([]);
  /** How many edits were typed into each Section by edits since gone from the list. */
  #typedGone = $state.raw(new Map<number, number>());

  /** The Timeline as saved. */
  savedTimeline: Timeline = $state.raw()!;
  /** Whether a save was refused, or a refresh couldn't be shown, because the Song changed elsewhere since it loaded. */
  stale = $state(false);
  /** Why the latest save on each surface failed, the surface that failed latest last. */
  #errors: Map<Surface, Refused> = $state.raw(new Map());
  /** How many saves are queued or on their way. */
  pending = $state(0);
  /** How many times a refresh has replaced the Song and its Timeline with those changed elsewhere. */
  replaced = $state(0);

  /** Whether there's an edit to undo, or one to redo. */
  canUndo = $state(false);
  canRedo = $state(false);

  // Every Timeline edit and Cue edit is kept to undo, in the order they
  // were made, for as long as the page is open. Once the Song changed
  // elsewhere, they'd no longer undo what they did, so they're forgotten.
  #history = new History();
  /** Undoable edits queued, which an undo waits for. */
  #undoablesQueued = $state(0);
  /**
   * Counts the Cue edits that failed, so were taken back: an undo pressed
   * for one before it failed has nothing to undo, rather than undoing the
   * edit before it.
   */
  #cueEditsFailed = 0;

  #queue: Promise<unknown> = Promise.resolve();
  /** Counts the saves queued. */
  #turns = 0;
  /** The latest save queued before a save error that only a save asked for since clears. */
  #errorKeptUntil = 0;
  #closed = false;
  #holds = 0;
  #refreshOnRelease = false;

  constructor(options: SavesOptions) {
    this.#server = options.server;
    this.#wait = options.wait ?? waitFor;
    this.#onReplace = options.onReplace ?? (() => {});
    this.#savedSong = options.song;
    this.savedTimeline = options.timeline;
  }

  /** The Song as shown: as saved, with the Cue changes not saved yet made on top. */
  get song(): Song {
    return this.#shown;
  }

  /** The Song as saved. */
  get savedSong(): Song {
    return this.#savedSong;
  }

  /**
   * Why the latest save failed, whichever surface it was made on, until a
   * later save lands on that surface.
   */
  get saveError(): string | null {
    let latest: string | null = null;
    for (const refused of this.#errors.values()) latest = refused.message;
    return latest;
  }

  /** Why the latest save on a surface failed, until a later one there lands. */
  errorOn(surface: Surface): string | null {
    return this.#errors.get(surface)?.message ?? null;
  }

  /** Whether anything isn't saved yet: saves on their way, Cue changes, or edits being typed. */
  get unsaved(): boolean {
    return this.pending > 0 || this.#unsavedCues.length > 0 || this.#typing.some((t) => t.unsaved);
  }

  /** How many edits kept to undo are queued or on their way, which an undo waits for. */
  get undoablesQueued(): number {
    return this.#undoablesQueued;
  }

  /**
   * Whether an edit being typed into a Section, on the list, isn't saved
   * yet: leaving its field saves it, so it's the next edit to undo, as Undo
   * pressed in a field does.
   */
  get unsavedInSections(): boolean {
    return this.#typing.some((t) => t.section !== undefined && t.unsaved);
  }

  /**
   * Puts an edit being typed, e.g. a field typed in place, on the list
   * whose edits not saved yet the Song has, until the function returned is
   * called, e.g. as its field goes.
   */
  typing = (entry: Typing): (() => void) => {
    this.#typing = [...this.#typing, entry];
    return () => {
      this.#typing = this.#typing.filter((t) => t !== entry);
      const { section } = entry;
      if (section === undefined || entry.typed === 0) return;
      this.#typedGone = new Map(this.#typedGone).set(section, (this.#typedGone.get(section) ?? 0) + entry.typed);
    };
  };

  /** The edits being typed in a Section, on the list. */
  typingIn(sectionId: number): Typing[] {
    return this.#typing.filter((t) => t.section === sectionId);
  }

  /**
   * How many edits have been typed into a Section, by the edits on the list
   * and those gone from it, e.g. to tell when typing carries on.
   */
  typedIn(sectionId: number): number {
    return this.typingIn(sectionId).reduce((n, t) => n + t.typed, this.#typedGone.get(sectionId) ?? 0);
  }

  /**
   * Queues a change to the Song, built against the Song as saved when its
   * turn comes, and shows the Song it returns. Resolves to whether it was saved.
   */
  change = (op: (saved: Song) => Promise<Song>): Promise<boolean> => this.submit(op).then((ended) => ended === 'saved');

  /**
   * Queues a Lyric Sheet change, named by its kind, like change, and keeps
   * it to undo: given the visit to a text field that typed it, as one step
   * with the changes that visit saved just before it.
   */
  changeLyricSheet = (change: LyricSheetChange, visit?: FieldVisit): Promise<boolean> => {
    this.#undoablesQueued++;
    return this.#turn(
      'lyricSheet',
      async (saved) => ({ before: saved, after: await this.#server.apply(saved, change) }),
      ({ before, after }) => {
        this.#savedSong = after;
        this.#history.recordSheet(before, after, visit);
        this.#showHistory();
      },
      (ended) => {
        this.#undoablesQueued--;
        return ended === 'saved';
      },
    );
  };

  /** Queues a change like change, resolving to how it ended. */
  submit = (op: (saved: Song) => Promise<Song>): Promise<Submitted> =>
    this.#turn(
      'details',
      op,
      (s) => (this.#savedSong = s),
      (ended) => ended,
    );

  /**
   * Queues a Timeline edit, made against the Timeline as saved when its
   * turn comes, and keeps it to undo, with the Clips selected as it was
   * made, if given, to select again on undoing it. Resolves to what it
   * did, or null if it wasn't saved.
   */
  edit = (edit: Edit, selected?: Iterable<number>): Promise<Edited | null> =>
    this.make(async (at) => ({ timeline: await this.#server.apply(at, edit), kept: edit }), selected);

  /**
   * Queues a rarer edit to the Timeline that the caller makes itself, e.g.
   * importing a Sound, saving a Take or a Merge. Its work runs in its turn,
   * against the Song and Timeline as saved then, with the Song on the
   * server to write through, and says how it's kept to undo, with the
   * Clips selected as it was made, if given, like edit. Resolves to what
   * it did, or null if it wasn't saved, e.g. when the work throws, whose
   * message becomes the save error.
   */
  make = (
    work: (at: Song, timeline: Timeline, server: SongServer) => Promise<Made>,
    selected?: Iterable<number>,
  ): Promise<Edited | null> => {
    const selectedThen = selected && [...selected];
    let edited: Edited | null = null;
    this.#undoablesQueued++;
    return this.#turn(
      'timeline',
      (at) => work(at, this.savedTimeline, this.#server),
      ({ timeline, kept }) => {
        const before = this.savedTimeline;
        if (kept === 'take') this.#history.recordTake(before, timeline);
        else this.#history.record(kept, before, timeline, selectedThen);
        this.#showHistory();
        this.#showTimeline(timeline);
        edited = { before, after: timeline };
      },
      () => {
        this.#undoablesQueued--;
        return edited;
      },
    );
  };

  /**
   * Undoes the latest edit, once the edits queued before it are saved,
   * unless stillWanted then says not, e.g. as the Song froze meanwhile.
   * Resolves to what it did, or null if there was nothing to undo or it
   * wasn't saved. An undo pressed for a Cue edit that then failed, so was
   * taken back, undoes nothing.
   */
  undo = (stillWanted: () => boolean = () => true): Promise<Undone | null> => {
    if (!this.canUndo && this.#undoablesQueued === 0) return Promise.resolve(null);
    const failedBefore = this.#cueEditsFailed;
    return this.#step(() => {
      if (!stillWanted() || this.#cueEditsFailed !== failedBefore) return null;
      const edit = this.#history.nextUndo();
      if (!edit) return null;
      const playhead = this.#history.nextUndoPlayhead();
      return {
        edit,
        done: ({ before, after }) => {
          // What to select again, if anything (see History.undone).
          const reselect = this.#history.undone(before, after);
          return { before, after, reselect, playhead };
        },
      };
    });
  };

  /** Redoes the latest edit undone, like undo. */
  redo = (stillWanted: () => boolean = () => true): Promise<Undone | null> => {
    if (!this.canRedo) return Promise.resolve(null);
    return this.#step(() => {
      if (!stillWanted()) return null;
      const edit = this.#history.nextRedo();
      if (!edit) return null;
      return {
        edit,
        done: ({ before, after }) => {
          // A Merge redone selects its Clip again, and a Split its right halves, as they did.
          const reselect = this.#history.redone(before, after);
          return { before, after, reselect, playhead: null };
        },
      };
    });
  };

  /**
   * Queues an undo or a redo: in its turn, next gives the edit to send and
   * what it did, or null if there's nothing to.
   */
  #step(next: () => Step | null): Promise<Undone | null> {
    let undone: Undone | null = null;
    // The edit to replay is picked in the turn, so its surface is only
    // known by the time a refusal has one to be remembered against.
    let replaying: Surface = 'timeline';
    return this.#turn(
      () => replaying,
      async (at) => {
        const step = next();
        if (!step) return null;
        replaying = surfaceOfEdit(step.edit);
        const before = this.savedTimeline;
        return { step, before, after: await this.#send(at, step.edit) };
      },
      (sent) => {
        if (!sent) return;
        const { step, before, after } = sent;
        let timeline = before;
        let section: number | null | undefined;
        if ('tracks' in after) this.#showTimeline((timeline = after));
        // A Cue edit or a Lyric Sheet change leaves the Timeline as it was.
        else {
          if (step.edit.kind === 'putSheetBack') section = changedSection(this.#savedSong, after);
          this.#savedSong = after;
        }
        undone = step.done({ before, after: timeline });
        if (section !== undefined) undone = { ...undone, section };
        this.#showHistory();
      },
      () => undone,
    );
  }

  /**
   * Sends an edit kept to undo or redo, giving the Timeline it leaves, or
   * for a Cue edit the Song. Cues whose Line is gone since, or can't take
   * one, can't come back: with none left, nothing is sent, and the Song is
   * as it was.
   */
  async #send(at: Song, edit: HistoryEdit): Promise<Timeline | Song> {
    // Apart, as apply takes a Lyric Sheet change and a Timeline edit apart.
    if (edit.kind === 'putSheetBack') return this.#server.apply(at, edit);
    if (edit.kind !== 'restoreCues') return this.#server.apply(at, edit);
    const cues = restorable(edit.cues, at);
    return cues.length > 0 ? this.#server.apply(at, { kind: 'restoreCues', cues }) : at;
  }

  /** Shows the Timeline an edit left, which moved the Song on too. */
  #showTimeline(timeline: Timeline) {
    this.savedTimeline = timeline;
    this.#savedSong = { ...this.#savedSong, version: timeline.version, updatedAt: timeline.updatedAt };
  }

  #showHistory() {
    this.canUndo = this.#history.nextUndo() !== null;
    this.canRedo = this.#history.nextRedo() !== null;
  }

  /** Forgets every edit kept, e.g. once the Song changed elsewhere. */
  #forget() {
    this.#history.clear();
    this.#showHistory();
  }

  /**
   * Queues setting the Song's Tags, which leaves its version as it was.
   * Resolves to the Tags as saved, in order and spelled as the Tags they
   * matched are, or null if they weren't.
   */
  setTags = (tags: string[]): Promise<string[] | null> => {
    let saved: string[] | null = null;
    return this.#turn(
      'details',
      () => this.#server.setTags(tags),
      (s) => {
        saved = s;
        this.#savedSong = { ...this.#savedSong, tags: s };
      },
      () => saved,
    );
  };

  /**
   * Makes a Cue change at once, and queues its save. If it still fails
   * after trying again, it's taken back, and the save error names what,
   * given as e.g. "the Cue of Line 3 of Verse". Refused because the Song
   * changed elsewhere, it stays shown like any edit not saved. Resolves to
   * whether it was saved.
   */
  cue = (change: CueChange, what: string): Promise<boolean> => {
    if (this.#closed) return Promise.resolve(false);
    const unsaved = { change };
    this.#unsavedCues = [...this.#unsavedCues, unsaved];
    const settle = () => (this.#unsavedCues = this.#unsavedCues.filter((u) => u !== unsaved));
    this.#undoablesQueued++;
    const op = async (saved: Song): Promise<Song> => {
      try {
        let tries = 0;
        const after = await savedRetrying(() => (tries++, this.#server.apply(saved, change)), this.#wait).catch((e) =>
          tries > 1 && e instanceof ApiError && e.stale ? this.#landedEarlier(saved, change, e) : Promise.reject(e),
        );
        // Shown as saved in the same step it stops being made on top, so
        // it's never made twice over.
        this.#savedSong = after;
        settle();
        // Kept to undo as what it changed in the Song as saved, whatever
        // Cue changes not saved yet the Song shown has.
        this.#history.recordCues(saved, after);
        this.#showHistory();
        return after;
      } catch (e) {
        this.#cueEditsFailed++;
        if (e instanceof ApiError && e.stale) throw e;
        settle();
        // Saves already waiting behind it don't clear what was taken back,
        // e.g. the Lines cued meanwhile in Sync mode: only one asked for since.
        this.#errorKeptUntil = this.#turns;
        throw new Error(`Couldn't save ${what}, so it was taken back. ${(e as Error).message}`);
      }
    };
    return this.#turn(
      'cues',
      op,
      () => {},
      (ended) => {
        this.#undoablesQueued--;
        return ended === 'saved';
      },
    );
  };

  /**
   * The Song a Cue change left, when trying it again was refused as the Song
   * changed meanwhile, and that change was its own first try, saved though
   * its answer never came back. Otherwise it was changed elsewhere after all.
   */
  async #landedEarlier(saved: Song, change: CueChange, refused: ApiError): Promise<Song> {
    const latest = await this.#server.getSong().catch(() => null);
    if (latest?.version === saved.version + 1 && sameCues(latest, withCueChange(saved, change))) return latest;
    throw refused;
  }

  /**
   * Shows an error found before saving a Detail, e.g. a field typed wrong,
   * until a later Details save lands.
   */
  report = (message: string) => {
    this.#refuse('details', message);
  };

  /**
   * Shows the Song as changed elsewhere since, e.g. on coming back to the
   * tab. It waits for saves already on their way, and never replaces edits
   * not saved yet: those are built against the Song as it was, so the Song
   * is marked stale instead. While held, it waits until released.
   */
  refresh = (): Promise<void> => {
    if (this.#closed) return Promise.resolve();
    if (this.#holds > 0) {
      this.#refreshOnRelease = true;
      return Promise.resolve();
    }
    const done = this.#queue.then(async () => {
      try {
        const latest = await this.#server.getSong();
        if (latest.version === this.#savedSong.version) return;
        if (this.unsaved) {
          this.stale = true;
          return;
        }
        const timeline = await this.#server.getTimeline();
        this.#onReplace(latest);
        this.#savedSong = latest;
        this.savedTimeline = timeline;
        this.stale = false;
        this.#forget();
        this.replaced++;
      } catch {
        // Keep showing the Song as it was; the next save reports any problem.
      }
    });
    this.#queue = done.then(hop);
    return done;
  };

  /**
   * Holds refreshes, e.g. while recording, as the Timeline a Take is made
   * against has to stay as it is. Returns the release; a refresh asked for
   * meanwhile runs once nothing holds them.
   */
  hold = (): (() => void) => {
    this.#holds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#holds--;
      if (this.#holds > 0 || !this.#refreshOnRelease) return;
      this.#refreshOnRelease = false;
      void this.refresh();
    };
  };

  /**
   * Deletes the Song once the saves queued have landed, so none lands after
   * it. From then on nothing is sent: every save resolves as not saved. If
   * the delete fails, Saves opens again. Resolves to whether it was deleted.
   */
  close = async (deleteSend: (saved: Song) => Promise<unknown>): Promise<boolean> => {
    this.#closed = true;
    try {
      await this.#queue;
      await deleteSend(this.#savedSong);
      return true;
    } catch (e) {
      // The Delete is pressed in the Song's header, with its Details.
      this.#fail(e, 'details');
      this.#closed = false;
      return false;
    }
  };

  /**
   * Queues a turn on a surface: op runs against the Song as saved once the
   * turns before it are over, show shows what it returns, and the result
   * says how it ended to the caller. Never rejects.
   */
  #turn<T, R>(
    on: OnSurface,
    op: (saved: Song) => Promise<T>,
    show: (result: T) => void,
    result: (ended: Submitted) => R,
  ): Promise<R> {
    if (this.#closed) return Promise.resolve(result('closed'));
    this.pending++;
    const turn = ++this.#turns;
    const done = this.#queue.then(async (): Promise<R> => {
      try {
        show(await op(this.#savedSong));
        this.#landed(surfaceOf(on), turn);
        return result('saved');
      } catch (e) {
        return result(this.#fail(e, surfaceOf(on)));
      } finally {
        this.pending--;
      }
    });
    this.#queue = done.then(hop);
    return done;
  }

  #fail(e: unknown, surface: Surface): Submitted {
    if (e instanceof ApiError && e.stale) {
      this.stale = true;
      this.#forget();
      return 'stale';
    }
    this.#refuse(surface, (e as Error).message);
    return 'failed';
  }

  /** Remembers why a save was refused against its surface, in place of the error that surface held. */
  #refuse(surface: Surface, message: string) {
    const errors = new Map(this.#errors);
    // Taken out before it goes back in, so the surface that failed latest
    // is last, and its message is the one saveError gives.
    errors.delete(surface);
    errors.set(surface, { message, keptUntil: this.#errorKeptUntil });
    this.#errorKeptUntil = 0;
    this.#errors = errors;
  }

  /** Clears a surface's error as a save lands there, leaving every other surface's standing. */
  #landed(surface: Surface, turn: number) {
    const refused = this.#errors.get(surface);
    if (!refused || turn <= refused.keptUntil) return;
    const errors = new Map(this.#errors);
    errors.delete(surface);
    this.#errors = errors;
  }
}

/**
 * The gap between turns: a caller awaiting a turn's result runs its code,
 * up to its next await, before the next turn starts.
 */
const hop = () => Promise.resolve();

/** An undo or a redo to send: the edit kept for it, and what it did once sent. */
interface Step {
  edit: HistoryEdit;
  done: (edited: Edited) => Undone;
}

/** A save refused: why, and the turn until which a save landing doesn't clear it. */
interface Refused {
  message: string;
  keptUntil: number;
}

/**
 * The surface a turn is on: the one its method stands for, or, for an undo
 * or a redo, whichever the edit it turns out to replay was made on.
 */
type OnSurface = Surface | (() => Surface);

const surfaceOf = (on: OnSurface): Surface => (typeof on === 'function' ? on() : on);

/** The surface an edit kept to undo was made on. */
const surfaceOfEdit = (edit: HistoryEdit): Surface =>
  edit.kind === 'restoreCues' ? 'cues' : edit.kind === 'putSheetBack' ? 'lyricSheet' : 'timeline';
