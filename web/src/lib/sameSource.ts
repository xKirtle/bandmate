// Whether a Beat fetched from a link is already in the Library, going by the
// clean link yt-dlp reports for it, which Bandmate keeps as its Source link.
// yt-dlp reports one link per video however it was pasted, so the same video
// pasted as youtu.be/… or with a playlist matches. A Source link typed by hand
// may still differ in ways that don't change the page, which are ignored.
// A file picked again is caught by its name and size instead, in beatBatch.ts.
import type { Beat } from './api';

/**
 * A link as compared: without its scheme, "www.", a trailing slash or a
 * fragment, and with its host in lowercase. The path and query are kept as
 * written, since they name the video. One that isn't a web address is
 * compared as written.
 */
function comparableLink(link: string): string {
  const text = link.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return text;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return text;
  const host = url.host.replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  return `${host}${path}${url.search}`;
}

/** The Beat in the Library whose Source link is this one, or null. */
export function beatWithSource<B extends Pick<Beat, 'sourceLink'>>(
  library: readonly B[],
  sourceLink: string,
): B | null {
  const link = comparableLink(sourceLink);
  if (link === '') return null;
  return library.find((b) => comparableLink(b.sourceLink) === link) ?? null;
}
