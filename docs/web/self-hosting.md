# Self-hosting

Bandmate runs as a single Docker container, or as a single program without Docker. Everything it stores (Songs, audio, Covers and Backups) lives in one `data` folder.

## Installing

With Docker Compose, save the repo's [`compose.yaml`](https://github.com/xKirtle/bandmate/blob/main/compose.yaml) in an empty folder:

```yaml
services:
  bandmate:
    image: ${BANDMATE_IMAGE:-ghcr.io/xkirtle/bandmate:latest}
    container_name: bandmate
    restart: unless-stopped
    # Run as the owner of ./data so the bind-mounted folder stays writable.
    user: "${PUID:-1000}:${PGID:-1000}"
    ports:
      - "${BANDMATE_PORT:-8080}:8080"
    volumes:
      - ./data:/data
    healthcheck:
      test: ["CMD", "/bandmate", "healthcheck"]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3
```

Then create the `data` folder and start it:

```sh
mkdir data
docker compose up -d
```

Or with plain Docker:

```sh
mkdir data
docker run -d --name bandmate --restart unless-stopped \
  --user "$(id -u):$(id -g)" -p 8080:8080 -v "$PWD/data:/data" \
  ghcr.io/xkirtle/bandmate:latest
```

Open http://localhost:8080. Bandmate has no login, so before opening it up beyond your own machine, read [Security](#security).

The Compose file runs the container as user `1000` unless you set `PUID` and `PGID`. That user must own the `data` folder, or Bandmate can't write to it.

### Without Docker

Docker is the easiest way to run Bandmate, because the image includes everything it needs. If you'd rather not use it, Bandmate also runs as a single program on Linux and macOS, either [downloaded ready-made](#downloading-it) or [built yourself](#building-it-yourself). Either way, it keeps its data in a `data` folder beside where you start it, and listens on port 8080. [Configuration](#configuration) changes either. On Windows, run Bandmate with Docker, or run the Linux program in [WSL](https://learn.microsoft.com/windows/wsl/install).

#### Downloading it

Every [release](https://github.com/xKirtle/bandmate/releases/latest) from v0.10.0 on has the program ready-made:

| Download                       | For                    |
| ------------------------------ | ---------------------- |
| `bandmate-linux-amd64.tar.gz`  | Linux on Intel or AMD  |
| `bandmate-linux-arm64.tar.gz`  | Linux on ARM           |
| `bandmate-darwin-arm64.tar.gz` | macOS on Apple silicon |
| `bandmate-darwin-amd64.tar.gz` | macOS on Intel         |

Download yours into a folder of its own, check it against the release's `SHA256SUMS`, and start it:

```sh
mkdir bandmate && cd bandmate
curl -fsSLO https://github.com/xKirtle/bandmate/releases/latest/download/bandmate-linux-amd64.tar.gz
curl -fsSLO https://github.com/xKirtle/bandmate/releases/latest/download/SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS   # on macOS: shasum -a 256 -c --ignore-missing SHA256SUMS
tar -xzf bandmate-linux-amd64.tar.gz
./bandmate
```

Download it with `curl`, as here: macOS won't open a program it hasn't verified if it was downloaded in a browser.

#### Building it yourself

You need [Git](https://git-scm.com), [Go](https://go.dev/dl/) 1.27 or later and [Node.js](https://nodejs.org) 26 or later. Check out the [latest release](https://github.com/xKirtle/bandmate/releases/latest)'s tag, build the web app, which the program includes, then build the program and start it:

```sh
git clone https://github.com/xKirtle/bandmate.git && cd bandmate
git checkout vX.Y.Z   # the latest release
(cd web && npm ci && npm run build)
CGO_ENABLED=0 go build -o bandmate \
  -ldflags "-X github.com/xKirtle/bandmate/internal/build.version=vX.Y.Z" ./cmd/bandmate
./bandmate
```

The `-ldflags` tell Settings → About which version it's running.

#### Adding Beats from links

To add Beats from links, install the three programs the image includes: yt-dlp, ffmpeg and QuickJS. Bandmate finds them on your `PATH`. Without them, everything else works, and adding from a link says it can't find yt-dlp.

```sh
brew install yt-dlp ffmpeg quickjs        # macOS, with Homebrew
sudo apt install yt-dlp ffmpeg quickjs    # Debian or Ubuntu
sudo pacman -S yt-dlp ffmpeg quickjs-ng   # Arch
```

Distributions' packages of yt-dlp can fall behind the sites it downloads from. If one stops working, install yt-dlp's [own build](https://github.com/yt-dlp/yt-dlp/releases/latest) instead. **Update**, in Settings → About, can only update yt-dlp's own build: update one from a package manager with that package manager.

### Health check

The Compose file checks Bandmate is healthy with `bandmate healthcheck`. For your own monitoring, `GET /api/health` returns `200 {"status":"ok"}` while Bandmate can reach its database, and `503` while it can't, or while it refuses to start, e.g. on a database a newer Bandmate changed.

## Configuration

Set these in a `.env` file next to `compose.yaml`. Without Docker, set them in Bandmate's environment instead, e.g. `BANDMATE_UPDATE_CHECK=off ./bandmate`. All are optional.

| Variable                 | Default    | What it does                                                                  |
| ------------------------ | ---------- | ----------------------------------------------------------------------------- |
| `BANDMATE_PORT`          | `8080`     | The port Bandmate is on, on your machine                                      |
| `BANDMATE_IMAGE`         | `…:latest` | Which version to run: see [Image tags](#image-tags)                           |
| `PUID` / `PGID`          | `1000`     | The user the container runs as. It must own `./data`                          |
| `BANDMATE_MAX_UPLOAD_MB` | `500`      | The largest audio file Bandmate takes, uploaded or downloaded, in megabytes   |
| `BANDMATE_UPDATE_CHECK`  | `on`       | `off` stops Bandmate checking GitHub for new versions of itself and of yt-dlp |
| `BANDMATE_ADD_FROM_LINK` | `on`       | `off` turns off [downloading Beats from links](/features#beats-from-a-link)     |

`BANDMATE_PORT`, `BANDMATE_IMAGE`, `PUID` and `PGID` are the Compose file's. Running Bandmate without Docker, it also reads `BANDMATE_ADDR`, the address it listens on (`:8080`), and `BANDMATE_DATA_DIR`, where it keeps its data (`./data`; the image sets it to `/data`).

## Security

Bandmate has **no login**: anyone who can reach it can read and change every Song. That's fine on your own machine. Anywhere else, put it behind a reverse proxy that adds HTTPS and authentication, and let only the proxy reach it. Downloading a Beat from a link is one long request, so give the proxy a read timeout of a few minutes.

Recording also needs HTTPS, or `localhost`: browsers don't allow the microphone otherwise.

To report a vulnerability, see [SECURITY.md](https://github.com/xKirtle/bandmate/blob/main/SECURITY.md).

### What Bandmate connects to

Bandmate only goes online when you do something that needs it:

| When you…                        | It connects to                                                | Turn it off with             |
| -------------------------------- | ------------------------------------------------------------- | ---------------------------- |
| Open Settings → About            | GitHub, for the latest Bandmate and yt-dlp, and release notes | `BANDMATE_UPDATE_CHECK=off`  |
| Add a Beat from a link           | The site the link is on                                       | `BANDMATE_ADD_FROM_LINK=off` |
| Press Update for yt-dlp in About | GitHub                                                        | `BANDMATE_ADD_FROM_LINK=off` |

## Updating

### Image tags

`:latest` is the newest release, and what most installs want. To control when you update, pin a version instead, by setting `BANDMATE_IMAGE`, e.g. `BANDMATE_IMAGE=ghcr.io/xkirtle/bandmate:0.4`.

| Tag            | What you get                                                                  |
| -------------- | ----------------------------------------------------------------------------- |
| `:latest`      | The newest release                                                            |
| `:X.Y`         | Fixes for that version, but no new features, e.g. `:0.4`                      |
| `:X.Y.Z`       | Exactly one release, e.g. `:0.4.0`. It never changes                          |
| `:edge`        | The latest development build, ahead of any release. It can change at any time |
| `:sha-<short>` | One development build, by its commit, e.g. `:sha-1a2b3c4`                     |

New features bump the middle number, and fixes alone the last one, as [CONTRIBUTING.md](https://github.com/xKirtle/bandmate/blob/main/CONTRIBUTING.md#versions) describes.

### Upgrading and rolling back

**To upgrade**, pull the new image and start it:

```sh
docker compose pull && docker compose up -d
```

Bandmate updates its database by itself when it starts. Before it does, it takes an **Upgrade copy**: a copy of the database as it was, in the `upgrade-copies` folder of the data folder, named after the version it's upgrading from, e.g. `before-0.14.2.db`. That's the version to run with it, to roll back. Bandmate keeps the newest three Upgrade copies and deletes older ones. It takes none on a new install, nor when the new version doesn't change the database.

When Bandmate doesn't know which version it's upgrading from, the copy is named by the date instead, e.g. `before-2026-10-10.db`. That happens on the first upgrade to a Bandmate that takes Upgrade copies, since older ones didn't record their version, and after running a development build (`:edge` or `:sha-<short>`), which isn't a version you could pull. If that name is taken, e.g. after upgrading from the same version twice, the date and time are added, e.g. `before-0.14.2-2026-10-10-153012.db`, and a date-named copy gets the time, e.g. `before-2026-10-10-153012.db`, so no copy is ever replaced.

Bandmate's log says what an upgrade did, before the line saying it's listening: where it put the Upgrade copy, each older one it deleted, and the database changes it applied, e.g.

```
copied the database to /data/upgrade-copies/before-0.14.2.db before upgrading it
deleted the older upgrade copy before-0.12.0.db, to keep the newest 3
upgraded the database: applied 0041_bandmate_version
```

A start that doesn't change the database adds nothing to the log, and a new install logs only that it set up a new database. To read the log, run `docker compose logs bandmate`.

An Upgrade copy holds the database alone: Songs, Beats and everything else Bandmate keeps, but not the audio, Covers or Backup files, which stay in the data folder as they are. To copy everything, [copy the data folder](#copying-the-data-folder).

**To roll back**, stop Bandmate, put the Upgrade copy in place of the database, and run the version it's named after. Everything done since that upgrade is lost, including audio and Covers deleted since. For example, back to 0.14.2:

```sh
docker compose down
mkdir newer-database && mv data/bandmate.db* newer-database/
cp data/upgrade-copies/before-0.14.2.db data/bandmate.db
```

Run these as the user that owns `data`, so Bandmate can still write to the database. Moving every `bandmate.db*` file takes the database's `-wal` and `-shm` files with it, if there are any, so none is left to mix with the copy, and keeps the newer database in case you upgrade again. Then pin the older version, by setting `BANDMATE_IMAGE=ghcr.io/xkirtle/bandmate:0.14.2` in `.env`, and start it with `docker compose up -d`.

To go back further, use an older copy, with the version it's named after. A date-named copy says no version: run the one you ran before that day's upgrade. A Bandmate from before Upgrade copies doesn't check what it's started on, and runs on a newer database without saying so, so going back to one, always put its copy back first. If an upgrade took no Upgrade copy, it didn't change the database: run the older tag, with nothing to put back.

**If Bandmate can't start** on its data folder, it changes nothing and keeps running, so Docker doesn't restart it in a loop, but every page says why, its log says the same, and the [health check](#health-check) fails. It's one of two reasons:

- **The database was changed by a newer Bandmate.** An older Bandmate was started on a database a newer one had changed, e.g. by running the older tag without putting an Upgrade copy back. Run the newer Bandmate again, or roll back as above.
- **Bandmate couldn't copy the database before upgrading it.** It couldn't take the Upgrade copy, so it hasn't changed the database, and the page says what failed. Usually Bandmate can't write to the `upgrade-copies` folder, which, like the rest of `data`, must be owned by the user it runs as (`PUID` and `PGID`), or the disk is full. Put that right and start Bandmate again, with `docker compose restart`. Until then, you can still run the version you upgraded from.

**Without Docker**, upgrade by stopping Bandmate, [downloading](#downloading-it) the new release over the old program, or checking out the newer tag and [building it again](#building-it-yourself), then starting it again. To roll back, stop it, put the Upgrade copy in place as above, and run the older release's program, from `https://github.com/xKirtle/bandmate/releases/download/vX.Y.Z/`.

### Copying the data folder

Stop Bandmate, so nothing is mid-write, and copy `data`. It holds everything: the database, audio, Covers, Backups and Upgrade copies. It's the way to copy everything, as an Upgrade copy leaves audio and Covers out. To back up only some Songs or Beats, from the app, see [Backups](/features#backups).

## Mounting your own yt-dlp

::: warning For advanced setups only
Most installs never need this: **Update**, in Settings → About, keeps yt-dlp current, as the [feature tour](/features#beats-from-a-link) describes.
:::

You need this only if Update says it **can't run programs from the data folder**. That happens when the data folder is mounted `noexec`, as on some NAS systems. Instead, give Bandmate a yt-dlp of your own:

1. Download yt-dlp's [standalone Linux build](https://github.com/yt-dlp/yt-dlp/releases/latest): `yt-dlp_linux`, or `yt-dlp_linux_aarch64` on ARM.
2. Make it executable: `chmod +x yt-dlp_linux`.
3. Mount it over the bundled one, with a line under `volumes:` in `compose.yaml`:

   ```yaml
       volumes:
         - ./data:/data
         - ./yt-dlp_linux:/usr/local/bin/yt-dlp:ro
   ```

4. Recreate the container: `docker compose up -d`.

To update it later, replace the file and recreate the container again.

## Licenses

Bandmate is licensed under the [GNU Affero General Public License v3.0](https://github.com/xKirtle/bandmate/blob/main/LICENSE). If you run a modified Bandmate as a service that others use over a network, you must offer them its source code.

To download Beats from links, the image also includes three programs under their own licenses: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (The Unlicense), [ffmpeg](https://ffmpeg.org) (LGPL v2.1 or later, built from its unmodified [source](https://ffmpeg.org/releases/) without its GPL parts) and [QuickJS](https://bellard.org/quickjs/) (MIT). Settings → About lists them with their versions, and their license texts are in the image at `/usr/local/share/licenses/`. Bandmate without Docker includes none of them.
