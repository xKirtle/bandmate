// What the Lyric Sheet says about a Section just moved, e.g. one added to
// another as Alternates, or one taken out with nothing written in it: one line
// at the top of the Lyric Sheet, for a few seconds. Made once per Song page
// and shared, so a move made from the Scrapbook says the same thing in the
// same place as the same move made in the Lyric Sheet. What each move says is
// settled in one place (see sectionMoves.ts).

/** How long a notice stays, in milliseconds. */
export const noticeShown = 5000;

/** The notice the Lyric Sheet shows, said from wherever a Section was moved. */
export class SheetNotice {
  #text = $state<string | null>(null);
  #shown: ReturnType<typeof setTimeout> | undefined;

  /** The notice shown, or null while there's none. */
  get text(): string | null {
    return this.#text;
  }

  /** Says a notice, in place of any shown, for its own time. */
  say = (text: string) => {
    clearTimeout(this.#shown);
    this.#text = text;
    this.#shown = setTimeout(() => (this.#text = null), noticeShown);
  };
}
