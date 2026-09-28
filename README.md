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

## Running it yourself

CI publishes the image to `ghcr.io/xkirtle/bandmate`, tagged `latest` and with each commit's SHA. Create a `data` folder owned by the user the container runs as, then start it with Docker Compose:

```yaml
services:
  bandmate:
    image: ghcr.io/xkirtle/bandmate:latest
    container_name: bandmate
    restart: unless-stopped
    # Run as the owner of ./data so the bind-mounted folder stays writable.
    user: "1000:1000"
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
```

Or with `docker run`:

```sh
docker run -d --name bandmate --restart unless-stopped \
  --user 1000:1000 \
  -p 8080:8080 \
  -v "$PWD/data:/data" \
  ghcr.io/xkirtle/bandmate:latest
```

Bandmate is then on http://localhost:8080. The image has its own healthcheck. Migrations run on startup, so upgrading means pulling the new image and recreating the container. To roll back, run an older SHA tag instead of `latest`. Back it up by copying `data/`.

Bandmate has no login, so anything that can reach it can read and change every Song. Anywhere beyond your own machine, put it behind a reverse proxy that handles HTTPS and authentication ([ADR 0002](docs/adr/0002-single-user-auth-at-proxy.md)). Browsers also only allow the microphone over HTTPS or on localhost.

## Releasing

1. Open a pull request. The [CI workflow](.github/workflows/ci.yml) type-checks, unit-tests and builds the SPA, and runs `go vet` and `go test`. Pushes to other branches don't run CI, so open a draft PR for early feedback.
2. Merge to `main`. CI runs again and, if it passes, builds and publishes the image to `ghcr.io/xkirtle/bandmate` tagged `latest` and with the commit SHA.

`main` requires the `test` check to pass before merging. (`image` only runs on `main`, so pull requests show it as skipped.)
