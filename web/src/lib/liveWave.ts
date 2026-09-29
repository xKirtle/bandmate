// The waveform of a Take while it records: its peaks built from each batch
// the capture sends, as peaks.ts builds them from the whole recording, so
// the waveform doesn't change once it's saved. They're drawn as bars in
// tiles, so only the last tile changes as it grows.
import type { Batch } from './capture';
import { peaksPerSecond } from './peaks';

/** How loud a peak is at or above which it clipped: −0.5 dBFS, rounded as peaks are. */
export const clipping = Math.round(10 ** (-0.5 / 20) * 1000) / 1000;

/** How many bars a tile holds. */
export const tileBars = 128;

export class LiveWave {
  // The peaks finished, and the loudest sample so far of the next.
  #peaks: number[] = [];
  #loudest = 0;
  // How many frames from the first are in, and where the next peak ends.
  #end = 0;
  #next: number;
  #stretch: number;
  // Of the peaks, how many come before the Clip's start.
  #skip: number;
  // The tiles last drawn, at a bar every perBar peaks, as of end frames in.
  #tiles: {
    perBar: number;
    end: number;
    bars: number;
    tiles: number[][];
  } | null = null;

  /**
   * A Take captured from frame first, at rate, whose Clip starts skip
   * seconds into it.
   */
  constructor(
    private first: number,
    rate: number,
    skip: number,
    private perSecond = peaksPerSecond,
  ) {
    this.#stretch = rate / perSecond;
    this.#next = Math.floor(this.#stretch);
    this.#skip = Math.round(skip * perSecond);
  }

  /** Adds a batch captured, after those before it; what's missing between them is silence. */
  add({ frame, samples }: Batch) {
    const at = frame - this.first;
    for (let s = Math.max(0, this.#end - at); s < samples.length; s++) {
      while (at + s >= this.#next) this.#finish();
      const v = Math.abs(samples[s]);
      if (v > this.#loudest) this.#loudest = v;
    }
    this.#end = Math.max(this.#end, at + samples.length);
  }

  #finish() {
    this.#peaks.push(round(this.#loudest));
    this.#loudest = 0;
    this.#next = Math.floor((this.#peaks.length + 1) * this.#stretch);
  }

  /** How many peaks there are, the last maybe unfinished. */
  get #count(): number {
    return this.#end > Math.floor(this.#peaks.length * this.#stretch) ? this.#peaks.length + 1 : this.#peaks.length;
  }

  #peak(i: number): number {
    return i < this.#peaks.length ? this.#peaks[i] : round(this.#loudest);
  }

  /** The peaks so far, as peaks.ts would compute them from what's been added. */
  peaks(): number[] {
    return Array.from({ length: this.#count }, (_, i) => this.#peak(i));
  }

  /**
   * The waveform from the Clip's start, as a bar every secondsPerBar, each
   * the loudest of its peaks, in tiles of tileBars. Full tiles stay the
   * same arrays as more comes, and the whole stays the same while nothing
   * does.
   */
  tiles(secondsPerBar: number): readonly (readonly number[])[] {
    const perBar = secondsPerBar * this.perSecond;
    const count = Math.max(0, Math.ceil((this.#count - this.#skip) / perBar));
    let t = this.#tiles;
    if (t?.perBar !== perBar) t = this.#tiles = { perBar, end: 0, bars: 0, tiles: [] };
    else if (t.end === this.#end) return t.tiles;
    // From the last bar drawn, which may have grown.
    const from = Math.max(0, t.bars - 1);
    const tiles = t.tiles.slice();
    for (let k = from; k < count; k++) {
      const tile = Math.floor(k / tileBars);
      if (tiles[tile] === t.tiles[tile]) tiles[tile] = tiles[tile]?.slice() ?? [];
      tiles[tile][k % tileBars] = this.#bar(k, perBar);
    }
    t.end = this.#end;
    t.bars = count;
    t.tiles = tiles;
    return tiles;
  }

  /** Where bar k's peaks end. */
  #barEnd(k: number, perBar: number): number {
    const start = this.#skip + Math.floor(k * perBar);
    return Math.max(start + 1, this.#skip + Math.floor((k + 1) * perBar));
  }

  #bar(k: number, perBar: number): number {
    const end = Math.min(this.#count, this.#barEnd(k, perBar));
    let loudest = 0;
    for (let i = Math.max(0, this.#skip + Math.floor(k * perBar)); i < end; i++) {
      loudest = Math.max(loudest, this.#peak(i));
    }
    return loudest;
  }
}

/** A peak as peaks.ts keeps it: at most 1, to 3 decimals. */
function round(loudest: number): number {
  return Math.round(Math.min(loudest, 1) * 1000) / 1000;
}
