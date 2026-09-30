import { describe, expect, it } from 'vitest';
import { licenseOf, packageDir } from './dependencyManifest';

describe('packageDir', () => {
  it('finds the package a bundled module is in', () => {
    expect(packageDir('/app/web/node_modules/svelte/src/internal/client/index.js')).toBe(
      '/app/web/node_modules/svelte',
    );
  });

  it('keeps a scoped package whole', () => {
    expect(packageDir('/app/web/node_modules/@tokenizer/inflate/lib/index.js')).toBe(
      '/app/web/node_modules/@tokenizer/inflate',
    );
  });

  it('takes a nested copy over the package that pulled it in', () => {
    expect(packageDir('/w/node_modules/music-metadata/node_modules/debug/src/browser.js')).toBe(
      '/w/node_modules/music-metadata/node_modules/debug',
    );
  });

  it('finds a module on Windows paths, and one a plugin marked virtual', () => {
    expect(packageDir('C:\\w\\node_modules\\ms\\index.js')).toBe('C:\\w\\node_modules\\ms');
    expect(packageDir('\0/w/node_modules/ms/index.js?commonjs-proxy')).toBe('/w/node_modules/ms');
  });

  it("doesn't count the app's own code", () => {
    expect(packageDir('/app/web/src/main.ts')).toBeNull();
    expect(packageDir('\0vite/preload-helper.js')).toBeNull();
  });
});

describe('licenseOf', () => {
  it('reads an SPDX expression', () => {
    expect(licenseOf({ license: 'MIT' })).toBe('MIT');
    expect(licenseOf({ license: '(MIT OR Apache-2.0)' })).toBe('(MIT OR Apache-2.0)');
  });

  it('reads the old object and array forms', () => {
    expect(licenseOf({ license: { type: 'BSD-3-Clause' } })).toBe('BSD-3-Clause');
    expect(licenseOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('MIT OR Apache-2.0');
  });

  it('says Unknown when there is none', () => {
    expect(licenseOf({})).toBe('Unknown');
    expect(licenseOf({ license: {} })).toBe('Unknown');
    expect(licenseOf({ licenses: [] })).toBe('Unknown');
  });
});
