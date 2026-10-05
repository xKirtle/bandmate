import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markPath } from './brandMark';

const webRoot = join(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(join(webRoot, path));
const indexHtml = read('index.html').toString();

// A Terracotta token's light value: its light set comes first in palettes.css.
const palettes = read('src/palettes.css').toString();
const token = (name: string) => palettes.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))?.[1];

/** The width and height a PNG's header gives. */
function pngSize(png: Buffer): [number, number] {
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe('brand marks', () => {
  it('declares a favicon and a home-screen icon, each a file the build ships', () => {
    for (const [rel, href] of [
      ['icon', '/favicon.svg'],
      ['icon', '/favicon.ico'],
      ['apple-touch-icon', '/apple-touch-icon.png'],
    ]) {
      expect(indexHtml).toMatch(new RegExp(`<link rel="${rel}" href="${href}"`));
      expect(read(join('public', href)).length).toBeGreaterThan(0);
    }
  });

  it('draws the favicon from the same mark as the app', () => {
    expect(read('public/favicon.svg').toString()).toContain(`d="${markPath}"`);
  });

  it("draws the static icons in Terracotta's light accent, the default Palette", () => {
    const favicon = read('public/favicon.svg').toString();
    expect(favicon).toContain(`fill="${token('accent')}"`);
    expect(favicon).toContain(`fill="${token('accent-text')}"`);
  });

  it("gives iOS a 180px PNG for the home screen, since it won't take an SVG", () => {
    expect(pngSize(read('public/apple-touch-icon.png'))).toEqual([180, 180]);
  });

  it("draws the repo's social preview card from the same mark, in Terracotta", () => {
    const card = read('../docs/brand/social-preview.svg').toString();
    expect(card).toContain(`d="${markPath}"`);
    expect(card).toContain(`fill="${token('accent')}"`);
    expect(card).toContain(`fill="${token('accent-text')}"`);
  });

  it('renders the social preview card at the 1280×640 GitHub asks for, under 1 MB', () => {
    const png = read('../docs/brand/social-preview.png');
    expect(pngSize(png)).toEqual([1280, 640]);
    expect(png.length).toBeLessThan(1024 * 1024);
  });

  it('packs the favicon.ico with 16 and 32px images', () => {
    const ico = read('public/favicon.ico');
    expect(ico.readUInt16LE(2)).toBe(1); // an icon, not a cursor
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + i * 16));
    expect(sizes.sort((a, b) => a - b)).toEqual([16, 32]);
  });
});
