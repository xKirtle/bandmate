# Bandmate

A personal songwriting companion: write and structure lyrics with chords, and later record takes over beats. Domain terms are in [CONTEXT.md](CONTEXT.md), the plan is in [docs/roadmap.md](docs/roadmap.md), and decisions are in [docs/adr/](docs/adr/).

It is one Go binary. The server exposes a JSON API under `/api`, stores data in SQLite, and serves the Svelte SPA from files built into the binary ([ADR 0001](docs/adr/0001-go-backend-svelte-spa.md)). It has no login. Authentication happens at the reverse proxy ([ADR 0002](docs/adr/0002-single-user-auth-at-proxy.md)).

## Configuration

| Variable            | Default  | Purpose                                             |
| ------------------- | -------- | --------------------------------------------------- |
| `BANDMATE_ADDR`     | `:8080`  | Listen address                                      |
| `BANDMATE_DATA_DIR` | `./data` | Directory holding the SQLite database (`bandmate.db`) |

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

```sh
docker compose up --build
```

This builds the image and serves Bandmate on http://localhost:8080 with data in `./data`. `compose.yaml` reads these variables (put them in a `.env` next to it):

| Variable         | Default                           | Purpose                                     |
| ---------------- | --------------------------------- | ------------------------------------------- |
| `BANDMATE_PORT`  | `8080`                            | Host port                                   |
| `BANDMATE_IMAGE` | `ghcr.io/xkirtle/bandmate:latest` | Image to run (or tag, with `--build`)       |
| `PUID` / `PGID`  | `1000`                            | User the container runs as. It must own `./data` |

## Tests

```sh
go test ./...                  # API tests: real handler, fresh SQLite per test
(cd web && npm run check)      # type-check the SPA
```

The tests go through the HTTP API only. `internal/app/helpers_test.go` starts the real handler in-process against a fresh SQLite database in a temporary directory, sends requests, and checks the responses. New tests should use it too.

## Deploying

Bandmate runs as its own compose stack on the MiniPC. Create the `data` folder owned by `PUID:PGID`, then either:

- run `docker compose up -d --build` from a checkout of this repo, which builds the image on the MiniPC, or
- copy `compose.yaml` alone and run `docker compose up -d`, which pulls `ghcr.io/xkirtle/bandmate:latest`. This only works once CI publishes that image.

Back it up by copying `data/`.

**Manual step:** add a site block for `bandmate.kirtle.net` to the Pi's Caddyfile, then reload Caddy. Replace the upstream with the MiniPC's address and `BANDMATE_PORT`:

```caddyfile
bandmate.kirtle.net {
	crowdsec
	import geoblock
	import tinyauth
	reverse_proxy <minipc-address>:8080
}
```
