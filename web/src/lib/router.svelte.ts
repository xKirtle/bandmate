// A minimal client-side router over the History API. The server falls back to
// index.html for unknown paths, so every route here survives a reload.

let path = $state(location.pathname);
// The query string, with its "?", or "" when there's none.
let search = $state(location.search);

addEventListener('popstate', () => {
  path = location.pathname;
  search = location.search;
});

export const router = {
  get path() {
    return path;
  },
  get search() {
    return search;
  },
};

/** Goes to an in-app path, adding a history entry unless replace is set. */
export function navigate(to: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  path = location.pathname;
  search = location.search;
  scrollTo(0, 0);
}

/**
 * Changes the current page's query string, e.g. as a list's filters change,
 * replacing its history entry so Back leaves the page rather than undoing
 * each change.
 */
export function replaceSearch(params: URLSearchParams) {
  const query = params.toString();
  history.replaceState(history.state, '', location.pathname + (query ? `?${query}` : '') + location.hash);
  search = location.search;
}

/**
 * Makes plain in-app <a href> links navigate without a full page load.
 * Attach once to a container: onclick={interceptLinks}.
 */
export function interceptLinks(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest('a');
  if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute('download')) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  navigate(url.pathname + url.search);
}
