import { describe, expect, it } from 'vitest';
import { beatWithSource } from './sameSource';

const night = { id: 1, title: 'Night', sourceLink: 'https://www.youtube.com/watch?v=abc' };
const day = { id: 2, title: 'Day', sourceLink: 'https://soundcloud.com/kofi/day' };
const library = [day, night];

describe('beatWithSource', () => {
  it('finds the Beat whose source link is the fetched one', () => {
    expect(beatWithSource(library, 'https://www.youtube.com/watch?v=abc')).toBe(night);
  });

  it('finds none for another video', () => {
    expect(beatWithSource(library, 'https://www.youtube.com/watch?v=xyz')).toBeNull();
  });

  // A Source link typed by hand may be written another way than yt-dlp's.
  it.each([
    ['http://www.youtube.com/watch?v=abc'],
    ['https://youtube.com/watch?v=abc'],
    ['https://WWW.YouTube.com/watch?v=abc'],
    ['https://www.youtube.com/watch?v=abc#t=30'],
    [' https://www.youtube.com/watch?v=abc '],
  ])('finds the Beat whose Source link was typed as %s', (typed) => {
    const typedIn = { id: 3, title: 'Night', sourceLink: typed };

    expect(beatWithSource([day, typedIn], 'https://www.youtube.com/watch?v=abc')).toBe(typedIn);
  });

  it('ignores a trailing slash on the path', () => {
    const typedIn = { id: 3, title: 'Day', sourceLink: 'https://soundcloud.com/kofi/day/' };

    expect(beatWithSource([typedIn], 'https://soundcloud.com/kofi/day')).toBe(typedIn);
  });

  it('tells videos apart by their query, which names the video on some sites', () => {
    expect(beatWithSource(library, 'https://www.youtube.com/watch?v=ABC')).toBeNull();
  });

  it('compares a Source link that is not a web address as written', () => {
    const odd = { id: 3, title: 'Odd', sourceLink: 'not a link' };

    expect(beatWithSource([odd], 'not a link')).toBe(odd);
  });

  it('finds none for a link that gave no source link, even beside Beats without one', () => {
    const noLink = { id: 3, title: 'Typed in', sourceLink: '' };

    expect(beatWithSource([...library, noLink], '')).toBeNull();
  });
});
