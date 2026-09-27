# Go backend serving a Svelte SPA

Bandmate is a Go HTTP API that serves a Svelte single-page app embedded in the same binary, rather than a full-stack SvelteKit app (or the author's usual .NET + React). Most of the app's complexity (recording, waveforms, the Timeline) lives in the browser either way, so the backend choice only covers storage and serving audio. Go was picked on purpose to learn a new language, and because it gives a small single-binary container and built-in HTTP Range support for seeking in audio.

## Considered Options

- **Full SvelteKit**: one TypeScript codebase with shared types and the fastest start, but a Node runtime and server rendering that's wasted on a single-user, very interactive app.
- **.NET + React**: the author's comfort zone, which defeats the point of learning something new.
