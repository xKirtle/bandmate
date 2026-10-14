// The Tour's offer on the empty Songs page: a quiet line under "Write your
// first Song", on a new install, until it's taken or turned down. Whether
// it's been offered is the server's, for the whole install, so a choice on
// one Device holds on every other. Otherwise the Songs page's header has the
// Tour, for taking again.
import type { TourOffered } from './api';

/** The Songs page, as the offer and the header's Take the Tour go by it. */
export interface SongsPage {
  /** Whether it shows nothing, no Song and no Folder: its empty state, where the offer goes. */
  empty: boolean;
  /** Whether the window is wide enough for the Tour. */
  wide: boolean;
}

/** The calls the offer goes through: the api, or a fake of it. */
export interface TourOfferSource {
  tourOffered: () => Promise<TourOffered>;
  markTourOffered: () => Promise<TourOffered>;
}

export class TourOffer {
  readonly #source: TourOfferSource;
  readonly #takeTour: () => void;
  /**
   * Whether it's been offered; null until that's read, or if it can't be,
   * when it isn't shown.
   */
  #offered = $state<boolean | null>(null);
  /** Whether reading that has finished, read or not. */
  #read = $state(false);
  /** Why taking or turning it down failed, shown beside it. */
  error = $state<string | null>(null);

  /** takeTour takes the Tour from the page showing the offer. */
  constructor(source: TourOfferSource, takeTour: () => void) {
    this.#source = source;
    this.#takeTour = takeTour;
  }

  /**
   * Reads whether it's been offered. If that can't be read, it isn't shown:
   * it's only an offer, and the header has the Tour too.
   */
  async load() {
    try {
      this.#offered = (await this.#source.tourOffered()).offered;
    } catch {
      this.#offered = null;
    }
    this.#read = true;
  }

  /**
   * Whether the Songs page shows it: if it hasn't been offered, the page is
   * empty, and the window is wide enough for the Tour.
   */
  shows({ empty, wide }: SongsPage) {
    return this.#offered === false && empty && wide;
  }

  /**
   * Whether the Songs page's header shows Take the Tour: on a wide window,
   * while the offer doesn't, once it's known whether the offer does: once
   * it's read whether it's been offered, and the page has loaded its list,
   * or failed to.
   */
  headerShows({ loaded, ...page }: SongsPage & { loaded: boolean }) {
    return this.#read && loaded && page.wide && !this.shows(page);
  }

  /** Take the Tour: marks it offered, then takes it. */
  async take() {
    if (await this.#markOffered()) this.#takeTour();
  }

  /** No thanks: marks it offered, so it's gone for good. */
  async decline() {
    await this.#markOffered();
  }

  async #markOffered() {
    this.error = null;
    try {
      this.#offered = (await this.#source.markTourOffered()).offered;
      return true;
    } catch (e) {
      this.error = (e as Error).message;
      return false;
    }
  }
}
