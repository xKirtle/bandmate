// The Cue gutter: the column beside a Section's Lines in Write mode, where
// each Line's Cue is shown, typed, played from and cleared, and where Sync
// mode puts the Now of the Line it cues next (see the GLOSSARY). It's made
// once per Song page, by the Lyric Sheet, which already holds everything it
// reads; each Section's Lines ask this one module rather than being handed a
// world of their own.
//
// It keeps what the gutter is: whether it's offered at all, how a Line's Cue
// is saved or cleared, what names a Line for screen readers, why a Line's
// Cue is out of order, which Line's field Enter goes on to, and, through
// Sync mode, which Line is up next and which Lines can be picked.
//
// The Cue rules themselves stay in cues.ts, which this calls: only Lines are
// cued, never a Section or its text (ADR 0005), an occurrence starting where
// its first Line is cued (ADR 0009), and a Line's Cue lying dormant while
// its Alternate is inactive, so only the active Alternates' Lines are
// ordered, marked and named here (ADR 0007). None of the three is reopened.
//
// Its options mirror Sync mode's (see syncMode.svelte.ts), which is one of
// them: two modules on the Song page reading the page the same way.
import type { Line, Song } from './api';
import type { CueChange } from './cueChanges';
import { hasCues, isBlank, leadIn, outOfOrderCues, outOfOrderReason, type OutOfOrderCue, type Position } from './cues';
import { activeAlternate, lineName, ofSection } from './sections';
import type { SyncMode } from './syncMode.svelte';

/** A Line's Cue field in the gutter, as far as Enter in another goes on to it. */
export interface GutterField {
  edit: () => void;
}

export interface CueGutterOptions {
  /** The Song as shown, Cue changes not saved yet made on top, whose Lines are cued; null until it's loaded. */
  song: () => Song | null;
  /** Whether the window is wide enough to edit Cues: the gutter is only offered where it is. */
  wide: () => boolean;
  /** Whether the Timeline has any Clip, so there's something to cue to. */
  hasClips: () => boolean;
  /**
   * Makes a Cue change, naming what it changes, e.g. "the Cue of Line 3 of
   * Verse", in case it has to be taken back; resolves to whether it was saved.
   */
  cue: (change: CueChange, what: string) => Promise<boolean>;
  /**
   * The Timeline's playing from a time, while there is one: a getter, as the
   * Timeline comes and goes with the page. A Cue's ▶ plays through it.
   */
  playFrom: () => ((at: number) => void) | undefined;
  /** Sync mode, whose Line up next the gutter marks, and which it cues and picks through. */
  sync: SyncMode;
}

export class CueGutter {
  #options: CueGutterOptions;
  /**
   * The Cue field of each Line that has one on the page just now, by Line.
   * The fields put themselves here as they're drawn, so Enter in one can go
   * on to the next down the sheet; a Line whose field has gone, e.g. because
   * typing that isn't saved has moved it, isn't in it.
   */
  #fields = new Map<number, GutterField>();

  constructor(options: CueGutterOptions) {
    this.#options = options;
  }

  /**
   * Whether the gutter is offered at all: on a window wide enough to edit
   * Cues, and only once there's something to cue to or a Cue already set.
   */
  readonly offered: boolean = $derived.by(() => {
    const song = this.#options.song();
    return this.#options.wide() && (this.#options.hasClips() || (song !== null && hasCues(song)));
  });

  /** Given, a ▶ beside each Cue plays from it, a second early to lead into it. */
  readonly play: ((to: number) => void) | undefined = $derived.by(() => {
    const playFrom = this.#options.playFrom();
    return playFrom && ((cue: number) => playFrom(leadIn(cue)));
  });

  /** Whether Sync mode is on, where the gutter marks the Line up next and a Line is picked by clicking it. */
  get syncing(): boolean {
    return this.#options.sync.on;
  }

  /** The Line Sync mode cues next, wherever in the sheet it is, or null while there is none. */
  get upNext(): number | null {
    return this.#options.sync.next?.line ?? null;
  }

  /** Ends the name of a Section's Lines for screen readers, e.g. " of Chorus". */
  labelSuffix(section: number): string {
    return ofSection(this.#sections.get(section)?.label);
  }

  /** Whether a Line's still in the Song, e.g. not deleted with its Section; a time typed into a Line that's gone is dropped. */
  has(line: number): boolean {
    return this.#line(line) !== undefined;
  }

  /** Sets, or with null clears, the Cue of a Line, naming it as the gutter names Lines. */
  save(at: Position, cue: number | null) {
    const song = this.#options.song();
    if (!song) return;
    this.#options.cue({ kind: 'setLineCue', lineId: at.line, cue }, `the Cue of ${lineName(song, at)}`);
  }

  /** Keeps a Line's Cue field, as it's drawn, or forgets it with null, as it goes. */
  setField(line: number, field: GutterField | null | undefined) {
    if (field) this.#fields.set(line, field);
    else this.#fields.delete(line);
  }

  /**
   * Opens the Cue field of the first Line after one, of the Lines in order
   * down the sheet, Sections and all; answers whether there was one. A Line
   * with no field just now is skipped.
   */
  editAfter(line: number): boolean {
    const order = this.#order;
    const next = order
      .slice(order.indexOf(line) + 1)
      .map((id) => this.#fields.get(id))
      .find((field) => field !== undefined);
    next?.edit();
    return next !== undefined;
  }

  /** Why a Line's Cue is out of order, naming the Line it clashes with, or null if it isn't. */
  outOfOrder(line: number): string | null {
    const song = this.#options.song();
    const mark = this.#marks.get(line);
    return song && mark ? outOfOrderReason(mark, (at) => lineName(song, at)) : null;
  }

  /** Cues the Line up next at the playhead, as Now does. */
  now() {
    this.#options.sync.cue();
  }

  /**
   * Whether a Line can be cued next, so clicking it picks it: only Lines
   * with words are cued, never a blank one nor a Chord Line.
   */
  pickable(line: number): boolean {
    const found = this.#line(line);
    return found !== undefined && !isBlank(found) && !found.chordLine;
  }

  /** Makes a Line, as clicked, the one Sync mode cues next, if it can be cued. */
  pick(at: Position) {
    if (this.pickable(at.line)) this.#options.sync.pick(at);
  }

  // The Song's Sections by id, the Scrapbook's included.
  #sections = $derived.by(() => new Map((this.#options.song()?.sections ?? []).map((s) => [s.id, s])));

  // The Lines with a Cue field, in order down the sheet: those of the active
  // Alternate of each Section in the Arrangement, blank ones left out, as
  // the gutter shows no field for them. This is where the order Enter walks
  // comes from, so no caller has to hand one over.
  #order: number[] = $derived.by(() => {
    const song = this.#options.song();
    if (!song) return [];
    const sections = this.#sections;
    return song.arrangement.flatMap((id) =>
      (activeAlternate(sections.get(id))?.lines ?? []).filter((line) => !isBlank(line)).map((line) => line.id),
    );
  });

  // The Cues out of order, by Line, each with the Cues it clashes with.
  #marks: Map<number, OutOfOrderCue> = $derived.by(() => {
    const song = this.#options.song();
    return new Map((song ? outOfOrderCues(song) : []).map((cue) => [cue.line, cue]));
  });

  // A Line of the Song, wherever it is: in an inactive Alternate or a
  // Scrapbook Section too, so a Line is only gone once it's left the Song.
  #line(line: number): Line | undefined {
    for (const section of this.#options.song()?.sections ?? []) {
      for (const alternate of section.alternates) {
        const found = alternate.lines.find((l) => l.id === line);
        if (found) return found;
      }
    }
    return undefined;
  }
}
