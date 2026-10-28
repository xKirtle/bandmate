// Puts text on the system clipboard, for the user to paste elsewhere: About's
// details for a bug report, a Voicing in the Chord Finder as a Song Voicing.

/**
 * Puts text on the clipboard, falling back to the old way where the
 * Clipboard API isn't offered, e.g. over plain HTTP on a local network.
 * Whether it was copied: false when the browser didn't allow it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
