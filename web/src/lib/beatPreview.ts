// What the Beat Library's preview player bar plays: a Beat already in the
// Library, or a file staged in the batch, played from the file picked.
import type { Beat } from './api';
import type { BatchRow } from './beatBatch';

/** A Beat in the Library, or a staged row whose file has been read. */
export type Preview = { beat: Beat } | { row: BatchRow };

/** How the bar credits what it plays: a staged file goes by the title typed for it, until then by its file name. */
export function previewCredit(
  preview: { beat: Pick<Beat, 'title' | 'producer'> } | { row: { file: Pick<File, 'name'>; draft: BatchRow['draft'] } },
): { title: string; byline: string } {
  if ('beat' in preview) {
    const { title, producer } = preview.beat;
    return { title, byline: producer || 'No producer credited' };
  }
  const name = preview.row.file.name;
  const title = preview.row.draft.title.trim();
  return title ? { title, byline: name } : { title: name, byline: '' };
}
