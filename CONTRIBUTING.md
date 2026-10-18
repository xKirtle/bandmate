# Contributing to Bandmate

Bandmate is a personal, single-user tool, and it's grown by designing each feature before building it. Bug reports and ideas are welcome, and so are pull requests for issues that have been agreed. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## How to contribute

1. **Open an issue first**, using the [bug report or idea form](https://github.com/xKirtle/bandmate/issues/new/choose). Report security vulnerabilities privately instead, as [SECURITY.md](SECURITY.md) describes.
2. **Pull requests are only for agreed issues**: ones labelled `ready-for-agent` or `ready-for-human`. Comment on the issue to claim it before you start, so two people don't build the same thing.

## The bar every pull request meets

Whoever or whatever wrote it: AI-written pull requests are welcome, and held to the same bar.

- **Use the glossary's terms.** [GLOSSARY.md](GLOSSARY.md) defines the words Bandmate uses (Song, Section, Alternate, Clip, Take and so on), and the words to avoid. Code, UI text, tests and the pull request itself use them.
- **Respect the ADRs.** [docs/adr/](docs/adr/) records the decisions Bandmate is built on, and why. If a change would contradict one, raise it on the issue first rather than working around it.
- **Follow [AGENTS.md](AGENTS.md).** It holds the repo's conventions, for people as much as for coding agents.
- **Format the code.** Run `npm run format` in `web/` for the web app, and `gofmt` on Go code. CI fails a pull request whose web code isn't formatted.
- **Add tests through the HTTP API.** See [Tests](#tests).
- **Title it for the release notes.** The title becomes the pull request's line in them, so it names the change a self-hoster notices, not the code that changed.
- **Label it** for the release notes, which are grouped by `enhancement`, `bug` and `documentation` and leave out `no-release-notes`, whatever else a pull request is labelled:
  - A feature gets `enhancement`, a fix `bug`, and a docs change `documentation`.
  - Add `no-release-notes` to a change no self-hoster would read or notice. Docs a self-hoster reads go in the notes: the README, the [docs site](docs/web/), and the licence and security policy. The rest get `no-release-notes`: this file, the [roadmap](docs/roadmap.md), AGENTS.md, the agent docs and skills, the glossary and the ADRs.
  - A refactor, tooling or CI gets `no-release-notes` alone.

## Development

### How it's built

Bandmate is one Go binary. It serves a JSON API under `/api`, stores everything in SQLite and audio files in the data folder, and serves the Svelte single-page app from files built into the binary ([ADR 0001](docs/adr/0001-go-backend-svelte-spa.md)). Recording, waveforms and the Timeline's playback all run in the browser. It has no login: authentication is the reverse proxy's job ([ADR 0002](docs/adr/0002-single-user-auth-at-proxy.md)).

The design is worked out in words before code. [GLOSSARY.md](GLOSSARY.md) is the glossary: the code, the UI and the issues all use its terms. The decisions that shaped it, and why, are the [ADRs](docs/adr/).

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

About, in Settings, lists every third-party package that ships, with its license. The SPA's build records the web packages in its bundle itself. The Go modules are in `internal/build/go-modules.json`, which is committed: after adding, removing or upgrading a Go module, run

```sh
go generate ./internal/build   # runs go-licenses, so it needs network access
```

and commit the result. CI fails a pull request whose manifest is stale, and says to re-run `go generate`.

The image also bundles three programs, for adding a Beat from a link ([ADR 0016](docs/adr/0016-bundle-yt-dlp-in-the-image.md)): yt-dlp, ffmpeg and QuickJS. The [Dockerfile](Dockerfile) pins each one's version and checksum in its `ARG`s, and records them with their licenses in `/usr/local/share/bandmate/programs.json`, which About lists. Their license texts ship in `/usr/local/share/licenses/`. A build outside the image has no such file, so About lists no programs. To upgrade one, change its `ARG`s. A [weekly workflow](.github/workflows/yt-dlp.yml) opens a pull request when yt-dlp releases, and starts CI on it, as a pull request opened by a workflow doesn't start CI on its own.

### Adding a rhyming language

Bandmate suggests Rhymes in the Languages it has data for, and won't take on every language itself: bring yours. Open an issue for it first, as for any change.

Rhymes match how words sound, never how they're spelt ([ADR 0022](docs/adr/0022-rhymes-match-pronunciations-never-spelling.md)), so a Language needs:

- **A pronouncing dictionary**, under a licence that lets it ship in an AGPL-3.0 program: each word with its pronunciation, as the CMU Pronouncing Dictionary writes English's: phones, with a stress digit on each vowel (1 for the stressed one, 2 for one stressed less, 0 for the rest). Its phones must keep apart the sounds a rhyme hears in that language, such as an open vowel from a closed one. One pronunciation a word is enough: its most usual one. A word the dictionary lacks gets no Rhymes.
- **Word frequencies** from [FrequencyWords](https://github.com/hermitdave/FrequencyWords), if it has a list for the language, so common Rhymes come first. Without one, they come nearest the word in syllables first, then alphabetically.

Where no ready-made pronouncing dictionary exists, generate one, as Portuguese (Portugal)'s is: the worked example to follow. Its generator, `internal/languagedata/ptpt`, takes the words of the European Portuguese Hunspell dictionary, with every form its prefixes and suffixes make but those said to vós, has [eSpeak NG](https://github.com/espeak-ng/espeak-ng) say each one, and writes eSpeak NG's IPA in one phone set (`phones.go`), which keeps open vowels apart from closed ones, and nasal from oral. eSpeak NG works a pronunciation out from spelling, so it slips on some vowels: where Wiktionary has the word, as [WikiPron](https://github.com/CUNY-CL/wikipron) gathers it, its reading settles whether the stressed vowel is open or closed, or an e eSpeak NG says as ɨ (`wiktionary.go`). Then `overrides.txt`, checked by hand, corrects the rest, and picks the usual reading of a word spelt the same as another, as "olho" (an eye, or "I look"). A list of word pairs that must and mustn't rhyme, in the tests, checks the result: when one fails, correct the word in `overrides.txt`.

Each step, with the file it touches, all in `internal/languagedata` unless it says otherwise:

1. **The data.** Write a generator, a `main` package in its own folder, like `cmudict/main.go`, or `ptpt` for a generated dictionary, that downloads its sources at pinned versions and writes `<code>.txt.gz`: one word a line, then its phones, gzipped. Add its `//go:generate` and `//go:embed` lines to `languagedata.go`, before FrequencyWords', as the ranks are built from it, with a version constant kept in step with each pin.
2. **The ranks.** Add a line for the Language to `ranked` in `frequencywords/main.go`, which writes `<code>.ranks.txt.gz`: its code, FrequencyWords' name for its list, which may differ from its code, as `pt` does from `pt-PT`, and whatever its list needs to match the dictionary, as Portuguese's old spellings do, or nil. Embed it in `languagedata.go`.
3. **The registry.** Add the Language to `registry` in `languagedata.go`: its BCP 47 code, naming where it's spoken if it's a variant that sounds different, as `pt-PT` does, its name in English, its data and ranks, and the credits of what its dictionary is made from, which About lists. That's the one list: a Song can be sung in it, and the Languages picker and Settings offer it, from there.
4. **The licences.** Add `<code>.LICENSE`, and `<code>.ranks.LICENSE` if it has ranks, beside the data, as `pt-PT.LICENSE` and `pt-PT.ranks.LICENSE` do: where each source came from, what was changed, and each licence's notice. Where a source is offered under several licences, name the one Bandmate takes, and give that in the credit.

Build the data with

```sh
go generate ./internal/languagedata   # downloads the dictionaries and lists, so it needs network access
```

and commit what it writes. Builds and CI use the committed files, so only regenerating needs what a generator runs. Portuguese (Portugal)'s needs eSpeak NG at the version `ptpt/espeak.go` pins: `espeak-ng` installed, or any command that runs it, such as a container's, in `ESPEAK_NG`:

```sh
docker build -t espeak-ng - <<'EOF'
FROM alpine:3.20
RUN apk add --no-cache espeak-ng
ENTRYPOINT ["espeak-ng"]
EOF
ESPEAK_NG="docker run --rm -i espeak-ng" go generate ./internal/languagedata
```

To rebuild only some of the data, name their generators: `go generate -run 'cmudict|frequencywords' ./internal/languagedata` needs no eSpeak NG.

Add tests, as for Portuguese (Portugal): in `internal/app/language_data_test.go`, that the data is served and holds some of its pronunciations, that its ranks start with its most common ones, and that About credits what it's made from, and add it to the Languages listed there; and in `web/src/lib/lyricsLanguage.test.ts`, some of its Rhymes and their Syllable Counts, and the pairs of words that must and mustn't be perfect Rhymes.

### Docker

To try a local build of the image, build it under a separate tag and point `BANDMATE_IMAGE` at it:

```sh
docker build -t bandmate:dev .
BANDMATE_IMAGE=bandmate:dev docker compose up
```

### Docs site

The [docs site](https://xkirtle.github.io/bandmate/) holds the features and the self-hosting guide, which the README links to rather than repeating. It's built with VitePress from the Markdown in [`docs/web/`](docs/web/):

```sh
cd docs/web
npm install
npm run dev     # http://localhost:5173/bandmate/
```

Write it for the person using or running Bandmate: what they can do, what they'll see, and what to do when something goes wrong. Leave out how it works inside (edge cases in how things are named, the order things happen in, file and table names they never touch, why the code does what it does) unless they need it to act. Test each sentence: would a reader do or decide anything differently without it? If not, cut it; the code, the glossary and the ADRs hold the rest. E.g. the upgrade guide says where the Upgrade copy is and how to roll back with it, not how a name that's already taken is changed.

A pull request that touches it builds it, which fails on a dead link. A release tag deploys it to GitHub Pages ([docs.yml](.github/workflows/docs.yml)), so it describes the latest release rather than `main`.

### Screenshots

The screenshots in the README and on the docs site are captured from a demo Bandmate. [docs/screenshots/README.md](docs/screenshots/README.md) says how to reseed it and recapture them when the UI changes.

## Tests

```sh
go test ./...                  # API tests: real handler, fresh SQLite per test
(cd web && npm run check)      # type-check the SPA
(cd web && npm test)           # unit tests for plain TypeScript modules in the SPA
```

The tests go through the HTTP API only. `internal/app/helpers_test.go` starts the real handler in-process against a fresh SQLite database in a temporary directory, sends requests, and checks the responses. New tests should use it too. To show what a failure the API can't cause does, e.g. that a change failing partway changes nothing, or that an error that isn't a domain error answers 500, a test injects a database fault with its `failStatements`: the database then fails every insert, update or delete on a chosen table until the test ends. The exceptions are checking that audio files are removed from the data directory, or that updating yt-dlp leaves no copy of it there, which the API can't show, checking the Upgrade copies in the data directory, which it can't show either, checking that the database file lands inside the data directory, whatever its path holds, and the pragmas its connection opens with, which it can't show either, putting a Backup's file made elsewhere or by an older Bandmate in place of one made through the API, a transaction's file changes when its commit fails, which `internal/audio`'s `FileChanges` tests directly as the API can't make a commit fail, the Timeline's placement rules, which `internal/timeline` table-tests on Timeline values through `checkLayout` (ADR 0023), as the API can't store a Clip that already breaks them, the searches for where a Clip fits (adding a Beat or a Sound, a Duplicate, a slowed Clip's new Track), which it table-tests on Timeline values beside them, the Lyric Sheet's rules, its changes and its writer, which `internal/lyricsheet` tests on LyricSheet values: the rules through `checkChange`, each pure change to the sheet on the sheet it leaves, and the writer by writing a sheet and loading it back, with the ids it hands new rows (ADR 0024), as the API can't store a sheet that already breaks the rules, nor show which rows a change writes, the Snapshot rules beside them, when a change takes a Snapshot and which are thinned, which it table-tests on sheets and times, as the API reaches each case only through a clock moved between requests, and `internal/build`'s rule for the version and source link, since a build's stamps are fixed when it's built.

Vitest covers plain TypeScript modules in `web/src/lib` that don't touch the DOM or Web Audio, e.g. reducing decoded audio to waveform peaks. Their tests sit next to them as `*.test.ts`. A module whose runes run effects, e.g. `songListQuery.svelte.ts`, is tested in a `*.svelte.test.ts`: those run with Svelte's browser build, as its server build runs no effects. A module that reads the page's elements, e.g. `keyPlace.ts` asking where a key was pressed, is tested against small DOM fixtures in [happy-dom](https://github.com/capricorn86/happy-dom), switched on for that file alone with a `// @vitest-environment happy-dom` comment at its top. Components and audio playback are tested by hand.

Unit tests of saving and editing a Song run against a fake of the server, `web/src/lib/songServerFake.ts`, which is checked against the real one. Each case in `internal/app/song_server_contract_test.go` sets a Song up through the API and makes one change, and the Song or Timeline before and after it are recorded to `internal/app/testdata/song_server_contract.json`. `songServerContract.test.ts` makes the same change on the fake and compares what it leaves. When the server changes what a change does, `go test` fails until the file is recorded again with `go test ./internal/app -run TestSongServerContract -update`, so review shows the change as a diff. Every kind of change has a case, or is in the fake's `notModelledKinds`, which it refuses; to model one, take it off that list and add a case.

### End-to-end tests

The suite in [`e2e/`](e2e/) drives the real app in Chromium with [Playwright](https://playwright.dev/), and pins what the pages do, so a change that moves code behind them can't change it unnoticed. Run it before and after such a change:

```sh
(cd web && npm ci)                # once: npm test builds the web app
cd e2e
npm ci
npx playwright install chromium   # once; or set CHROMIUM=/usr/bin/chromium to use your own
npm test                          # builds the web app, then runs every test
npm test -- tests/songs.spec.ts   # or only some
npm run check                     # type-check the suite
```

It needs Go too: the suite builds the Bandmate binary once, then each worker starts its own Bandmate on a free port, with an empty data directory of its own. A failed test keeps its trace in `e2e/test-results/`; open it with `npx playwright show-trace <trace.zip>`.

Tests import `test` and `expect` from `e2e/fixtures.ts`, and:

- go through the UI only, finding things by their role and accessible name, and check only what a user sees, or what the server holds afterwards, read back through the API;
- make the Songs and Folders they need through the HTTP API, with the `bandmate` fixture (`e2e/bandmate.ts`), which empties Bandmate before each test, or restore the demo Backup with `bandmate.restoreDemo()` when they need a full Timeline;
- inject faults in the browser with `e2e/faults.ts`: fail a request N times, let it reach the server but lose its answer, or hold it until released.

## Releasing

### Continuous integration

1. Open a pull request. The [CI workflow](.github/workflows/ci.yml) checks the SPA's formatting, type-checks, unit-tests and builds it, checks the Go license manifest is up to date, and runs `go vet` and `go test`. Its `e2e` job runs the [end-to-end tests](#end-to-end-tests), retrying a failed test once, and uploads the traces of failed tests as the run's `e2e-traces` artifact. Its `bundle` job builds the image, runs yt-dlp, ffmpeg and QuickJS in it, checks yt-dlp finds the other two, and checks the image starts healthy. Pushes to other branches don't run CI, so open a draft PR for early feedback. A pull request that only changes docs or other files outside the build skips the tests.
2. Merge to `main`. CI doesn't test again: it builds and publishes the image to `ghcr.io/xkirtle/bandmate` tagged `edge` and `sha-<short>` (the commit's short SHA). A merge never moves `latest`.

`main` requires a pull request to pass `test`, `bundle` and `e2e`, and to be up to date with `main`, before it merges, so what lands is what CI checked. A pull request that falls behind, because another merged first, needs updating (**Update branch**, or `gh pr update-branch`), and its checks run again. (`image` only runs on pushes, so pull requests show it as skipped.)

### Versions

A release with any new feature bumps the minor version (v1.4.0 to v1.5.0), and one with only fixes bumps the patch (v1.4.0 to v1.4.1). A release with a database migration bumps the minor too, whatever its pull requests are labelled: pulling the previous image doesn't undo a migration, and a patch should be one a self-hoster can drop in and back out of. `no-release-notes` pull requests don't count, whatever else they're labelled: a release of only those isn't worth cutting. Versions aren't tied to the [roadmap](docs/roadmap.md): whatever has merged since the last release goes out together. v1.0.0 is the one exception: it marks the roadmap entries wanted for it, Snapshots (#985) and a tutorial (#986), being done, and is when Bandmate is announced.

From v1.0.0 on, every release in a major version keeps these promises to self-hosters, and a release that breaks one bumps the major version instead (v1.4.0 to v2.0.0):

- The data folder upgrades in place: Bandmate updates its database itself when it starts, keeping an Upgrade copy to roll back to.
- A Backup restores into the Bandmate that made it, or a newer one.
- The image tags and the `BANDMATE_*` settings keep their meaning.
- Bandmate stays single-user, with authentication at the reverse proxy ([ADR 0002](docs/adr/0002-single-user-auth-at-proxy.md)).

### Cutting a release

Tag first, and publish the GitHub Release only once CI has published the image. Every running Bandmate checks GitHub's latest release, so a release published before its image exists tells people to update to an image they can't pull.

1. Tag `main` and push the tag:

   ```sh
   git switch main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   The tag triggers CI, which tests it and publishes the image tagged `X.Y.Z`, `X.Y`, `X` (from v1.0.0 on) and `latest`.

2. Watch the run with `gh run watch`. If it fails, nothing public has changed: delete the tag (`git push origin :vX.Y.Z && git tag -d vX.Y.Z`), fix the cause on `main`, and tag again.
3. Check that `X.Y.Z`, `X.Y`, `X` and `latest` show the same digest:

   ```sh
   docker buildx imagetools inspect ghcr.io/xkirtle/bandmate:X.Y.Z
   ```

4. Publish the release on the existing tag:

   ```sh
   gh release create vX.Y.Z --verify-tag --generate-notes
   ```

   The notes list the pull requests merged since the last release, grouped by their labels ([.github/release.yml](.github/release.yml)). Read them before publishing, because About, in Settings, shows them. Where they read poorly, write the notes by hand and pass `--notes-file` instead. v0.4.0 is one of those: it's the first release, and most earlier pull requests have no label.

5. Publishing the release starts the [Binaries workflow](.github/workflows/binaries.yml), which attaches Bandmate's binary for Linux and macOS, on amd64 and arm64, and a `SHA256SUMS` file to it. Each binary is the one the image runs, without the programs the image bundles. Check that all five assets arrived:

   ```sh
   gh release view vX.Y.Z --json assets --jq '.assets[].name'
   ```

   If the workflow fails, fix the cause and run it again for the tag: `gh workflow run binaries.yml -f tag=vX.Y.Z`. It replaces whatever assets the failed run left.
