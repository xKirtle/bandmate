# Contributing to Bandmate

Bandmate is a personal, single-user tool, and it's grown by designing each step before building it. Bug reports and ideas are welcome, and so are pull requests for issues that have been agreed. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## How to contribute

1. **Open an issue first**, using the [bug report or idea form](https://github.com/xKirtle/bandmate/issues/new/choose). Report security vulnerabilities privately instead, as [SECURITY.md](SECURITY.md) describes.
2. **Pull requests are only for agreed issues**: ones labelled `ready-for-agent` or `ready-for-human`. Comment on the issue to claim it before you start, so two people don't build the same thing.

## The bar every pull request meets

Whoever or whatever wrote it: AI-written pull requests are welcome, and held to the same bar.

- **Use the glossary's terms.** [CONTEXT.md](CONTEXT.md) defines the words Bandmate uses (Song, Section, Alternate, Clip, Take and so on), and the words to avoid. Code, UI text, tests and the pull request itself use them.
- **Respect the ADRs.** [docs/adr/](docs/adr/) records the decisions Bandmate is built on, and why. If a change would contradict one, raise it on the issue first rather than working around it.
- **Follow [AGENTS.md](AGENTS.md).** It holds the repo's conventions, for people as much as for coding agents.
- **Format the code.** Run `npm run format` in `web/` for the web app, and `gofmt` on Go code. CI fails a pull request whose web code isn't formatted.
- **Add tests through the HTTP API.** See [Tests](#tests).
- **Label it** `enhancement`, `bug` or `documentation`, exactly one. The release notes are grouped by these labels.

## Development

Requirements: Go 1.27+ and Node 26+.

### Dev mode

Run the API and the Vite dev server in two terminals:

```sh
# Terminal 1: API on :8080, data in ./data
go run ./cmd/bandmate

# Terminal 2: SPA with hot reload on http://localhost:5173, proxying /api to :8080
cd web
npm install
npm run dev
```

If the API runs somewhere else, set `BANDMATE_API=http://host:port` for `npm run dev`.

### Production build without Docker

```sh
(cd web && npm ci && npm run build)   # builds web/dist, which the binary embeds
go build -o bandmate ./cmd/bandmate
./bandmate
```

If the SPA hasn't been built, the binary still runs, but non-API pages show a "web app hasn't been built" message.

### Dependencies and their licenses

The About page lists every third-party package that ships, with its license. The SPA's build records the web packages in its bundle itself. The Go modules are in `internal/build/go-modules.json`, which is committed: after adding, removing or upgrading a Go module, run

```sh
go generate ./internal/build   # runs go-licenses; needs sh and network access
```

and commit the result. CI fails a pull request whose manifest is stale, and says to re-run `go generate`.

### Docker

To try a local build of the image, build it under a separate tag and point `BANDMATE_IMAGE` at it:

```sh
docker build -t bandmate:dev .
BANDMATE_IMAGE=bandmate:dev docker compose up
```

### Screenshots

The README's screenshots are captured from a demo Bandmate. [docs/screenshots/README.md](docs/screenshots/README.md) says how to reseed it and recapture them when the UI changes.

## Tests

```sh
go test ./...                  # API tests: real handler, fresh SQLite per test
(cd web && npm run check)      # type-check the SPA
(cd web && npm test)           # unit tests for plain TypeScript modules in the SPA
```

The tests go through the HTTP API only. `internal/app/helpers_test.go` starts the real handler in-process against a fresh SQLite database in a temporary directory, sends requests, and checks the responses. New tests should use it too. The exceptions are checking that audio files are removed from the data directory, which the API can't show, and `internal/build`'s rule for the version and source link, since a build's stamps are fixed when it's built.

Vitest covers plain TypeScript modules in `web/src/lib` that don't touch the DOM or Web Audio, e.g. reducing decoded audio to waveform peaks. Their tests sit next to them as `*.test.ts`. Components and audio playback are tested by hand.

## Releasing

### Continuous integration

1. Open a pull request. The [CI workflow](.github/workflows/ci.yml) checks the SPA's formatting, type-checks, unit-tests and builds it, checks the Go license manifest is up to date, and runs `go vet` and `go test`. Pushes to other branches don't run CI, so open a draft PR for early feedback. A pull request that only changes docs or other files outside the build skips the tests.
2. Merge to `main`. CI runs again and, if it passes, builds and publishes the image to `ghcr.io/xkirtle/bandmate` tagged `edge` and `sha-<short>` (the commit's short SHA). A merge never moves `latest`.

`main` requires the `test` check to pass before merging. (`image` only runs on pushes, so pull requests show it as skipped.)

### Versions

Versions follow the [roadmap](docs/roadmap.md): v0.N is the release that ships step N, so Record, step 4, is v0.4.0. Patch releases (v0.4.1, v0.4.2 and so on) carry fixes and small features between steps. v1.0.0 comes when the roadmap is done.

### Cutting a release

```sh
gh release create vX.Y.Z --generate-notes
```

This tags `main` as `vX.Y.Z` and publishes the release, with notes generated from the pull requests merged since the last one and grouped by their labels ([.github/release.yml](.github/release.yml)). The tag triggers CI, which tests it and publishes the image tagged `X.Y.Z`, `X.Y` and `latest`.
