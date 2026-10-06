import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fullScreenQuery, uprightPhoneQuery } from './timelineLayout';

// The full-screen Timeline on a phone held sideways is laid out in CSS and
// told apart in script by the same query, so the two never disagree.

const src = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(src, path), 'utf8');
/** Every @media query in some CSS, as written. */
const mediaQueries = (code: string) => [...code.matchAll(/@media ([^{]+?)\s*\{/g)].map((m) => m[1]);

describe('the full-screen Timeline', () => {
  it('is any landscape window under 30rem tall', () => {
    expect(fullScreenQuery).toBe('(orientation: landscape) and (height < 30rem)');
  });

  it('is laid out by the Timeline, and the page and navigation give way to it, under that query', () => {
    expect(mediaQueries(read('lib/Timeline.svelte'))).toContain(fullScreenQuery);
    expect(mediaQueries(read('app.css'))).toContain(fullScreenQuery);
  });

  it('takes the place of the transport row alone, however narrow the window', () => {
    // An upright phone's layout leaves out every window the full-screen one takes.
    expect(uprightPhoneQuery).toBe('(max-width: 40rem) and ((orientation: portrait) or (height >= 30rem))');
    const timeline = mediaQueries(read('lib/Timeline.svelte'));
    expect(timeline).toContain(uprightPhoneQuery);
    expect(timeline.filter((q) => /max-width: 40rem|width < 40rem/.test(q))).toEqual([uprightPhoneQuery]);
  });
});
