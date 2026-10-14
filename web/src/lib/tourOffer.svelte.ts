// The Tour's offer on the empty Songs page: a quiet line under "Write your
// first Song", on a new install, until it's taken or turned down. Whether
// it's been offered is the server's, for the whole install, so a choice on
// one Device holds on every other.
import type { TourOffered } from './api';

/** The calls the offer goes through: the api, or a fake of it. */
export interface TourOfferSource {
  tourOffered: () => Promise<TourOffered>;
  markTourOffered: () => Promise<TourOffered>;
}

export class TourOffer {
  readonly #source: TourOfferSource;
  readonly #takeTour: () => void;
  /** Whether it's been offered; null until that's known, when it isn't shown. */
  #offered = $state<boolean | null>(null);
  /** Why taking or turning it down failed, shown beside it. */
  error = $state<string | null>(null);

  /** takeTour takes the Tour from the page showing the offer. */
  constructor(source: TourOfferSource, takeTour: () => void) {
    this.#source = source;
    this.#takeTour = takeTour;
  }

  /**
   * Reads whether it's been offered. If that can't be read, it isn't shown:
   * it's only an offer, and About has the Tour too.
   */
  async load() {
    try {
      this.#offered = (await this.#source.tourOffered()).offered;
    } catch {
      this.#offered = null;
    }
  }

  /**
   * Whether the empty Songs page shows it: if it hasn't been offered, there
   * are no Songs, and the window is wide enough for the Tour.
   */
  shows({ anySongs, wide }: { anySongs: boolean; wide: boolean }) {
    return this.#offered === false && !anySongs && wide;
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
