import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { TourOffer } from './tourOffer.svelte';

/**
 * A server knowing whether the Tour was offered, which marks it offered for
 * good; while failing, it answers every mark with an error.
 */
function fakeServer(offered: boolean) {
  const server = {
    offered,
    failing: false,
    marks: 0,
    source: {
      tourOffered: () => Promise.resolve({ offered: server.offered }),
      markTourOffered: () => {
        server.marks++;
        if (server.failing) return Promise.reject(new ApiError(500, 'database unreachable'));
        server.offered = true;
        return Promise.resolve({ offered: true });
      },
    },
  };
  return server;
}

/** An offer read from server, whose Tour taken is counted rather than made. */
async function newOffer(server: ReturnType<typeof fakeServer>) {
  let taken = 0;
  const offer = new TourOffer(server.source, () => taken++);
  await offer.load();
  return { offer, taken: () => taken };
}

const empty = { anySongs: false, wide: true };

describe('the offer of the Tour', () => {
  it('shows on a new install with no Songs, on a wide window', async () => {
    const { offer } = await newOffer(fakeServer(false));
    expect(offer.shows(empty)).toBe(true);
  });

  it("doesn't show on a phone", async () => {
    const { offer } = await newOffer(fakeServer(false));
    expect(offer.shows({ anySongs: false, wide: false })).toBe(false);
  });

  it("doesn't show once a Song exists", async () => {
    const { offer } = await newOffer(fakeServer(false));
    expect(offer.shows({ anySongs: true, wide: true })).toBe(false);
  });

  it("doesn't show once it's been offered", async () => {
    const { offer } = await newOffer(fakeServer(true));
    expect(offer.shows(empty)).toBe(false);
  });

  it("doesn't show until it's known whether it's been offered", () => {
    const offer = new TourOffer(fakeServer(false).source, () => {});
    expect(offer.shows(empty)).toBe(false);
  });

  it("doesn't show if that can't be read", async () => {
    const offer = new TourOffer(
      {
        tourOffered: () => Promise.reject(new ApiError(500, 'database unreachable')),
        markTourOffered: () => Promise.reject(),
      },
      () => {},
    );
    await offer.load();
    expect(offer.shows(empty)).toBe(false);
    expect(offer.error).toBeNull();
  });

  it('takes the Tour, marked offered for good, so it shows no more', async () => {
    const server = fakeServer(false);
    const { offer, taken } = await newOffer(server);

    await offer.take();

    expect(taken()).toBe(1);
    expect(server.offered).toBe(true);
    expect(offer.shows(empty)).toBe(false);
    // Read again, as another Device or a return to the page would.
    expect((await newOffer(server)).offer.shows(empty)).toBe(false);
  });

  it('is gone for good with No thanks, the Tour not taken', async () => {
    const server = fakeServer(false);
    const { offer, taken } = await newOffer(server);

    await offer.decline();

    expect(taken()).toBe(0);
    expect(server.offered).toBe(true);
    expect(offer.shows(empty)).toBe(false);
    expect((await newOffer(server)).offer.shows(empty)).toBe(false);
  });

  it("says so and stays when it can't be marked offered, the Tour not taken", async () => {
    const server = fakeServer(false);
    server.failing = true;
    const { offer, taken } = await newOffer(server);

    await offer.take();
    expect(taken()).toBe(0);
    expect(offer.shows(empty)).toBe(true);
    expect(offer.error).toBe('database unreachable');

    await offer.decline();
    expect(offer.shows(empty)).toBe(true);
    expect(offer.error).toBe('database unreachable');

    // A try that works clears it.
    server.failing = false;
    await offer.decline();
    expect(offer.shows(empty)).toBe(false);
    expect(offer.error).toBeNull();
  });
});
