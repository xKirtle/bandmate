# Bandmate

A personal songwriting companion: write and structure lyrics with chords, and later record takes over beats. Domain terms are in [CONTEXT.md](CONTEXT.md), the plan is in [docs/roadmap.md](docs/roadmap.md), and decisions are in [docs/adr/](docs/adr/).

It is one Go binary. The server exposes a JSON API under `/api`, stores data in SQLite, and serves the Svelte SPA from files built into the binary ([ADR 0001](docs/adr/0001-go-backend-svelte-spa.md)). It has no login. Authentication happens at the reverse proxy ([ADR 0002](docs/adr/0002-single-user-auth-at-proxy.md)).

## Configuration

| Variable                 | Default  | Purpose                                                                           |
| ------------------------ | -------- | --------------------------------------------------------------------------------- |
| `BANDMATE_ADDR`          | `:8080`  | Listen address                                                                    |
| `BANDMATE_DATA_DIR`      | `./data` | Directory holding the SQLite database (`bandmate.db`) and audio files (`audio/`) |
| `BANDMATE_MAX_UPLOAD_MB` | `500`    | Largest audio file accepted for upload, in megabytes                              |

Schema migrations are built into the binary and run automatically on startup. To upgrade, run the new version.

`GET /api/health` returns `200 {"status":"ok"}` when the database is reachable. `bandmate healthcheck` calls it and exits non-zero on failure. The container healthcheck uses it because the image has no shell or curl.

## Running locally

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

### Docker

`compose.yaml` runs the image CI publishes to GHCR. To run a local build instead, build it under a separate tag and point `BANDMATE_IMAGE` at it:

```sh
docker build -t bandmate:dev .
BANDMATE_IMAGE=bandmate:dev docker compose up
```

This serves Bandmate on http://localhost:8080 with data in `./data`. `compose.yaml` reads these variables (put them in a `.env` next to it):

| Variable         | Default                           | Purpose                                          |
| ---------------- | --------------------------------- | ------------------------------------------------ |
| `BANDMATE_PORT`  | `8080`                            | Host port                                        |
| `BANDMATE_IMAGE` | `ghcr.io/xkirtle/bandmate:latest` | Image to run                                     |
| `PUID` / `PGID`  | `1000`                            | User the container runs as. It must own `./data` |

## Tests

```sh
go test ./...                  # API tests: real handler, fresh SQLite per test
(cd web && npm run check)      # type-check the SPA
(cd web && npm test)           # unit tests for plain TypeScript modules in the SPA
```

The tests go through the HTTP API only. `internal/app/helpers_test.go` starts the real handler in-process against a fresh SQLite database in a temporary directory, sends requests, and checks the responses. New tests should use it too. The one exception is checking that audio files are removed from the data directory, which the API can't show.

Vitest covers plain TypeScript modules in `web/src/lib` that don't touch the DOM or Web Audio, e.g. reducing decoded audio to waveform peaks. Their tests sit next to them as `*.test.ts`. Components and audio playback are tested by hand.

## Deploying

Bandmate runs as its own compose stack on the MiniPC, managed by Dockhand. The stack only needs `compose.yaml` (and a `.env` if the defaults don't fit) plus a `data` folder owned by `PUID:PGID`. It pulls `ghcr.io/xkirtle/bandmate:latest`.

Back it up by copying `data/`.

### Release flow

1. Open a pull request. The [CI workflow](.github/workflows/ci.yml) type-checks, unit-tests and builds the SPA, and runs `go vet` and `go test`. Pushes to other branches don't run CI, so open a draft PR for early feedback.
2. Merge to `main`. CI runs again and, if it passes, builds and publishes the image to `ghcr.io/xkirtle/bandmate` tagged `latest` and with the commit SHA.
3. Redeploy the stack in Dockhand, which pulls the new `latest`. Migrations run on startup.

To roll back, set `BANDMATE_IMAGE=ghcr.io/xkirtle/bandmate:<older-sha>` in the stack's `.env` and redeploy.

### One-time setup

- **Block failing changes.** In the repo's settings, add a branch protection rule (or ruleset) for `main` that requires the `test` check to pass before merging. (`image` only runs on `main`, so pull requests show it as skipped.)
- **Package visibility.** The first publish creates the `bandmate` package under the account's GitHub packages. Check its visibility there. If it's public, nothing else is needed. If it's private, log the MiniPC in to the registry with a personal access token (classic) that has the `read:packages` scope:

  ```sh
  echo <token> | docker login ghcr.io -u xKirtle --password-stdin
  ```

  If Dockhand pulls with its own registry settings rather than the Docker daemon's, add `ghcr.io` there with the same token.

**Manual step:** add a site block for `bandmate.kirtle.net` to the Pi's Caddyfile, then reload Caddy. Replace the upstream with the MiniPC's address and `BANDMATE_PORT`:

```caddyfile
bandmate.kirtle.net {
	crowdsec
	import geoblock
	import tinyauth
	reverse_proxy <minipc-address>:8080
}
```
