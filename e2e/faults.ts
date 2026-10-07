import type { BrowserContext, Page, Request, Route } from '@playwright/test';

// Faults injected into the app's requests in the browser, with Playwright's
// request interception: the server is never told. Each applies to a Page, or
// to a BrowserContext to cover every tab in it, from when it's made until
// it's spent, or, for a hold, released. A request it doesn't match, or once
// it's spent, goes on as it would have, through any other route.

/** Which requests a fault applies to: a method, e.g. 'PATCH', and a URL glob, RegExp or predicate. */
export interface RequestMatch {
  method?: string;
  url: string | RegExp | ((url: URL) => boolean);
}

type Target = Page | BrowserContext;

/** A fault that applies to a number of requests. */
export interface Fault {
  /** How many requests it has applied to so far. */
  readonly count: number;
  /** Settles once it has applied to as many requests as it's for. */
  readonly spent: Promise<void>;
}

/**
 * Answers the next `times` requests matched with an error, without them
 * reaching the server: by default a 500 with a JSON error, as Bandmate gives,
 * or, with status 0, a network failure.
 */
export async function failRequests(
  target: Target,
  match: RequestMatch,
  { times = 1, status = 500, error = 'Injected failure' }: { times?: number; status?: number; error?: string } = {},
): Promise<Fault> {
  return applyTimes(target, match, times, (route) =>
    status === 0
      ? route.abort('failed')
      : route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) }),
  );
}

/**
 * Sends the next `times` requests matched to the server, then loses its
 * answer: the server has done what was asked, but the app sees a network
 * failure, as when the connection drops on the way back.
 */
export async function loseAnswers(target: Target, match: RequestMatch, { times = 1 } = {}): Promise<Fault> {
  return applyTimes(target, match, times, async (route) => {
    await route.fetch();
    await route.abort('failed');
  });
}

/** Requests held by holdRequests, until released. */
export interface Hold {
  /** The requests held so far. */
  readonly held: readonly Request[];
  /** Settles with the first request held, once it's made. */
  readonly reached: Promise<Request>;
  /** Sends every request held so far on to the server, and stops holding more. */
  release(): Promise<void>;
}

/**
 * Holds every request matched, not sending it to the server until released,
 * as a slow connection or server would. Release it before the test ends.
 */
export async function holdRequests(target: Target, match: RequestMatch): Promise<Hold> {
  const held: Request[] = [];
  let releasing = false;
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let reach!: (request: Request) => void;
  const reached = new Promise<Request>((resolve) => (reach = resolve));
  const continuing: Promise<void>[] = [];

  const handler = async (route: Route) => {
    if (releasing || !matches(route.request(), match)) return route.fallback();
    held.push(route.request());
    reach(route.request());
    const done = released.then(() => route.fallback());
    continuing.push(done);
    await done;
  };
  await target.route(match.url, handler);
  return {
    held,
    reached,
    async release() {
      releasing = true;
      await target.unroute(match.url, handler);
      release();
      await Promise.all(continuing);
    },
  };
}

/** Routes the first `times` requests matched through apply, and the rest on as usual. */
async function applyTimes(
  target: Target,
  match: RequestMatch,
  times: number,
  apply: (route: Route) => Promise<void>,
): Promise<Fault> {
  let count = 0;
  let spend!: () => void;
  const spent = new Promise<void>((resolve) => (spend = resolve));
  const handler = async (route: Route) => {
    if (count >= times || !matches(route.request(), match)) return route.fallback();
    count++;
    await apply(route);
    if (count === times) spend();
  };
  await target.route(match.url, handler);
  return {
    get count() {
      return count;
    },
    spent,
  };
}

// Playwright matches the URL; the method, and a predicate, are checked here.
function urlMatcher(match: RequestMatch): string | RegExp | ((url: URL) => boolean) {
  return match.url;
}

function matches(request: Request, match: RequestMatch): boolean {
  return match.method === undefined || request.method() === match.method.toUpperCase();
}
