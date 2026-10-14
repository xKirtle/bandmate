// The Tour: a short guided look at Bandmate's core loop on the Demo Song,
// which only shows. Its steps, and where it is in them. Nothing of it is
// kept: a reload ends it. Drawn by TourSpotlight.

/** A step of the Tour. */
export interface Step {
  title: string;
  text: string;
  /**
   * The control it spotlights, by the `data-tour` attribute that control
   * carries on the Demo Song's page; none for a step with nothing to show,
   * whose card sits in the middle of the window.
   */
  control?: string;
  /** A link shown in the step, e.g. to the docs. */
  link?: { href: string; text: string };
}

/**
 * Every step, in order. A new one can only show what's on the Demo Song's
 * page, and what the Demo holds; its control gets a matching `data-tour`.
 */
export const steps: readonly Step[] = [
  {
    title: 'Sections',
    text: 'This is a Section, the building block of a Song. Its Label, here “Verse”, names it, and you can call yours anything.',
    control: 'first-section-head',
  },
  {
    title: 'Lines',
    text: 'This is where a Section’s Lines are written, one to a line, as you would in a notebook.',
    control: 'first-section-lines',
  },
  {
    title: 'Chords',
    text: 'Chords sit over the words they fall on. Each is written in brackets just before its word, like [Am]Folded, and shows above the word in Read mode.',
    control: 'first-section-lines',
  },
  {
    title: 'The Arrangement',
    text: 'The Sections in order are the Arrangement. Here the Chorus comes round again: a Duplicate of the first, which can be changed on its own. The arrows move a Section up or down.',
    control: 'last-section-head',
  },
  {
    title: 'The Timeline',
    text: 'This is the Timeline. The Demo Beat sits on its Track as a Clip, and the play button plays it, with the Lyric Sheet above to sing along to.',
    control: 'timeline',
  },
  {
    title: 'Recording a Take',
    text: 'This is where recording a Take starts. Record captures you onto the chosen Track over whatever the Timeline plays, and keeps every Take so you can pick the best.',
    control: 'record',
  },
  {
    title: 'Clips',
    text: 'A Clip is moved by dragging it along its Track, and trimmed by dragging either of its edges.',
    control: 'clip',
  },
  {
    title: 'That’s the core of it',
    text: 'Alternates, the Scrapbook, the Chord Finder, Snapshots, Folders, Tags and Backups are all in the docs.',
    link: { href: 'https://xkirtle.github.io/bandmate/features', text: 'Open the docs' },
  },
];

/** The window the Tour needs: a wide one. It isn't offered on a phone, and ends if narrowed to one. */
export const tourFits = 'min-width: 40.0625rem';

/** Where the Demo Song's page is: it shows the Demo only while a Tour runs. */
export const demoPath = '/songs/demo';

export class Tour {
  readonly #go: (to: string) => void;
  readonly #goBack: (to: string) => void;
  /** Where it was taken from, to go back to as it ends; null while it isn't running. */
  #from = $state<string | null>(null);
  /** The step showing, from 0. */
  #at = $state(0);

  /**
   * go goes to an in-app address; goBack goes back to `to`, the page the Tour
   * was taken from, the one before the Demo Song's in the history.
   */
  constructor({ go, goBack }: { go: (to: string) => void; goBack: (to: string) => void }) {
    this.#go = go;
    this.#goBack = goBack;
  }

  get running() {
    return this.#from !== null;
  }

  get step(): Step {
    return steps[this.#at];
  }

  /** How far through it is, e.g. "3 of 8". */
  get count() {
    return `${this.#at + 1} of ${steps.length}`;
  }

  /** The step showing, from 0. */
  get at() {
    return this.#at;
  }

  /** Whether the step showing is the last, whose Next is Finish. */
  get last() {
    return this.#at === steps.length - 1;
  }

  /** Takes the Tour from `from`, the address it goes back to: it opens the Demo Song at step 1. */
  start(from: string) {
    this.#from = from;
    this.#at = 0;
    this.#go(demoPath);
  }

  /** Next: the next step, or on the last, Finish, which ends it. */
  next() {
    if (!this.running) return;
    if (this.last) this.end();
    else this.#at++;
  }

  back() {
    if (this.running && this.#at > 0) this.#at--;
  }

  /** Ends it, going back to where it was taken from. */
  end() {
    const from = this.#from;
    if (from === null) return;
    this.#from = null;
    this.#goBack(from);
  }

  /** Ends it without going anywhere, e.g. once the Demo Song has been left. */
  stop() {
    this.#from = null;
  }
}
