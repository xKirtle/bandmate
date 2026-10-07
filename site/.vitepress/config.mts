import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

const repo = 'https://github.com/xKirtle/bandmate';

// Published to GitHub Pages at xkirtle.github.io/bandmate when a release is
// tagged, so it describes the latest release, never unreleased main.
export default defineConfig({
  title: 'Bandmate',
  description: 'Write songs with chords. Record takes over your beats. Self-hosted.',
  base: '/bandmate/',
  cleanUrls: true,
  // The pages point at a running Bandmate on localhost.
  ignoreDeadLinks: 'localhostLinks',
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/bandmate/favicon.svg' }]],
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Features', link: '/features' },
      { text: 'Self-hosting', link: '/self-hosting' },
      { text: 'Releases', link: `${repo}/releases` },
    ],
    sidebar: [
      {
        text: 'Bandmate',
        items: [
          { text: 'Features', link: '/features' },
          { text: 'Self-hosting', link: '/self-hosting' },
        ],
      },
      {
        text: 'In the repository',
        items: [
          { text: 'Glossary', link: `${repo}/blob/main/GLOSSARY.md` },
          { text: 'Roadmap', link: `${repo}/blob/main/docs/roadmap.md` },
          { text: 'Contributing', link: `${repo}/blob/main/CONTRIBUTING.md` },
          { text: 'Security policy', link: `${repo}/blob/main/SECURITY.md` },
        ],
      },
    ],
    outline: [2, 3],
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/main/site/:path`, text: 'Edit this page on GitHub' },
    search: { provider: 'local' },
    footer: { message: 'Released under the GNU Affero General Public License v3.0.' },
  },
  // The pages show the README's screenshots from docs/screenshots, outside
  // this folder, so retaking them updates both. They're reached through an
  // alias, as the dev server drops the base from a plain ../ path out here.
  vite: {
    resolve: { alias: { '@screenshots': fileURLToPath(new URL('../../docs/screenshots', import.meta.url)) } },
    server: { fs: { allow: ['..'] } },
  },
});
