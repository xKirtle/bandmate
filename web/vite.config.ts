import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { Dependency } from './src/lib/api';
import { licenseOf, packageDir } from './src/lib/dependencyManifest';

/** Writes dependencies.json into the build: every node_modules package whose
    code ends up in the bundle, measured from the bundle itself, with its
    version and license from its own package.json. The Go binary embeds it
    with the SPA, for the About page. */
function dependencyManifest(): Plugin {
  return {
    name: 'bandmate:dependency-manifest',
    apply: 'build',
    generateBundle(_, bundle) {
      const found = new Map<string, Dependency>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(chunk.modules)) {
          const dir = packageDir(id);
          // Code that was tree-shaken away doesn't ship.
          if (!dir || module.renderedLength === 0) continue;
          const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
          found.set(`${pkg.name}@${pkg.version}`, { name: pkg.name, version: pkg.version, license: licenseOf(pkg) });
        }
      }
      const dependencies = [...found.values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
      );
      this.emitFile({
        type: 'asset',
        fileName: 'dependencies.json',
        source: JSON.stringify(dependencies, null, 2) + '\n',
      });
    },
  };
}

// In dev, the Go server runs separately (default :8080) and Vite proxies the
// API to it. BANDMATE_API overrides where the API lives.
export default defineConfig({
  plugins: [svelte(), dependencyManifest()],
  server: {
    proxy: {
      '/api': process.env.BANDMATE_API ?? 'http://localhost:8080',
    },
  },
});
