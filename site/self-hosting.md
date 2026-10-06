# Self-hosting

Bandmate is one container, holding everything it keeps in one `data` folder.

## Installing

Releases are published as images to `ghcr.io/xkirtle/bandmate`. Create a `data` folder owned by the user the container runs as, then start it with Docker Compose, using the repo's [`compose.yaml`](https://github.com/xKirtle/bandmate/blob/main/compose.yaml):

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

```sh
mkdir data
docker compose up -d
```

Or with `docker run`:

```sh
docker run -d --name bandmate --restart unless-stopped \
  --user 1000:1000 \
  -p 8080:8080 \
  -v "$PWD/data:/data" \
  ghcr.io/xkirtle/bandmate:latest
```

Bandmate is then on http://localhost:8080. Before using it anywhere beyond your own machine, read [Security](#security).

### Health check

`GET /api/health` returns `200 {"status":"ok"}` when the database is reachable. `bandmate healthcheck` calls it and exits non-zero on failure. The container healthcheck uses it because the image has no shell or curl.

## Configuration

The Compose file reads these variables (put them in a `.env` next to it):

| Variable         | Default                           | Purpose                                          |
| ---------------- | --------------------------------- | ------------------------------------------------ |
| `BANDMATE_PORT`  | `8080`                            | Host port                                        |
| `BANDMATE_IMAGE` | `ghcr.io/xkirtle/bandmate:latest` | Image to run                                     |
| `PUID` / `PGID`  | `1000`                            | User the container runs as. It must own `./data` |

Bandmate itself reads these:

| Variable                 | Default  | Purpose                                                                                                                    |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `BANDMATE_ADDR`          | `:8080`  | Listen address                                                                                                             |
| `BANDMATE_DATA_DIR`      | `./data` | Directory holding the SQLite database (`bandmate.db`), audio files (`audio/`), Covers (`covers/`) and Backups (`backups/`) |
| `BANDMATE_MAX_UPLOAD_MB` | `500`    | Largest audio file accepted for upload, in megabytes                                                                       |
| `BANDMATE_UPDATE_CHECK`  | `on`     | `off` stops the About tab asking GitHub for the latest release, the release notes and yt-dlp's latest release              |
| `BANDMATE_ADD_FROM_LINK` | `on`     | `off` stops Beats being added from a link: Add from link and About's yt-dlp row are hidden, and Bandmate refuses both      |

The image sets `BANDMATE_DATA_DIR` to `/data`, the folder the examples above mount.

### Adding a Beat from a link

A fetch takes the audio of one video, never a playlist, a channel or a live stream, and keeps it as an m4a. It's held to `BANDMATE_MAX_UPLOAD_MB`, like an upload, and stopped after 10 minutes. The fetched audio waits in `audio/waiting/` in the data folder until it's added, and is deleted after an hour if it isn't, or when Bandmate restarts. A fetch is one long request, so a reverse proxy in front of Bandmate needs a read timeout long enough for it.

### Mounting your own yt-dlp

When a site changes, yt-dlp can stop fetching from it until a newer yt-dlp fixes it. A Bandmate release brings one. Until then, About, in Settings, shows the yt-dlp in use under System information, and offers **Update** there when a newer yt-dlp has been released (or when it can't check), which runs yt-dlp's own update on a copy in `programs/` in the data folder. Of the bundled yt-dlp and that copy, whichever is newer is used, so an old update never stands in for a fresher yt-dlp a later Bandmate bundles.

Some setups, such as a NAS, mount the data folder `noexec`, so no program can run from it. There, updating keeps the bundled one and says so. Instead, download yt-dlp's [standalone Linux build](https://github.com/yt-dlp/yt-dlp/releases/latest) (`yt-dlp_linux`, or `yt-dlp_linux_aarch64` on ARM), make it executable, and mount it over the bundled one, at `/usr/local/bin/yt-dlp`, with a line under `volumes:` in the Compose file:

```yaml
    volumes:
      - ./data:/data
      - ./yt-dlp_linux:/usr/local/bin/yt-dlp:ro
```

Then recreate the container (`docker compose up -d`). The mounted yt-dlp counts as the bundled one, so an update in the data folder is still used if it's newer.

## Security

Bandmate has no login, so anything that can reach it can read and change every Song. Anywhere beyond your own machine, put it behind a reverse proxy that handles HTTPS and authentication, and let only the proxy reach it. Browsers also only allow the microphone, which recording needs, over HTTPS or on localhost.

To report a vulnerability, and for what counts as one, see [SECURITY.md](https://github.com/xKirtle/bandmate/blob/main/SECURITY.md).

### Outbound calls

Bandmate makes four kinds of outbound call, each only when asked: the update check, when About is opened (to GitHub); the check for yt-dlp's latest release, also when About is opened (to GitHub); when the user adds a Beat from a link, the fetch of that link (to the site it's on, through yt-dlp); and when the user presses Update in About's yt-dlp row, yt-dlp's own update (to GitHub). `BANDMATE_UPDATE_CHECK=off` turns off the first two, and `BANDMATE_ADD_FROM_LINK=off` the last three.

## Updating

### Image tags

Each release is published under these tags:

| Tag            | What it is                                                                            |
| -------------- | ------------------------------------------------------------------------------------- |
| `:X.Y.Z`       | One release, e.g. `:0.4.0`. It never changes.                                         |
| `:X.Y`         | The newest patch release of that version, e.g. `:0.4`: fixes and small features only. |
| `:latest`      | The newest release.                                                                   |
| `:edge`        | The latest build of `main`, ahead of any release. Expect it to change without notice. |
| `:sha-<short>` | One build of `main`, by its commit, e.g. `:sha-1a2b3c4`.                              |

A release with new features bumps the minor version, and one with only fixes bumps the patch, as [CONTRIBUTING.md](https://github.com/xKirtle/bandmate/blob/main/CONTRIBUTING.md#versions) describes. Pin `:X.Y` to get fixes without new features, or `:X.Y.Z` to change only when you choose. Set the tag with `BANDMATE_IMAGE`, e.g. `BANDMATE_IMAGE=ghcr.io/xkirtle/bandmate:0.4`.

### Upgrading and rolling back

**Upgrading:** pull the new image and recreate the container (`docker compose pull && docker compose up -d`). Database migrations are built into the binary and run automatically on startup.

**Rolling back:** run an older version tag instead. Migrations only go forward, so an older version doesn't undo a newer one's changes to the database. If the release you're leaving changed the database, put back the copy of the `data` folder you took before upgrading along with the older tag.

## Backups

The Backups tab, in Settings, makes a Backup of the Songs you choose, the whole Beat Library, or both, and keeps it in Bandmate. Download a Backup as one file to keep elsewhere, and upload it to this install or another. A Restore brings back what you pick from a Backup. Where the same Song or Beat is already in Bandmate, even from another install, you choose to replace it or keep both, and nothing the Backup doesn't hold is deleted. A newer Bandmate restores an older one's Backups, never the other way round.

**Copying the data folder:** the low-level option. Stop Bandmate, so the database isn't mid-write, and copy the `data` folder. It holds the database, every audio file, every Cover and every Backup, so the copy holds everything. Copy it before each upgrade: rolling back needs the folder as it was before the new version's migrations changed it.

## Licenses

Bandmate is licensed under the [GNU Affero General Public License v3.0](https://github.com/xKirtle/bandmate/blob/main/LICENSE). If you run a modified Bandmate as a service that others use over a network, you must offer them the source code of your modified version.

The image also bundles three programs under their own licenses, for adding a Beat from a link: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (The Unlicense), [ffmpeg](https://ffmpeg.org) (LGPL v2.1 or later, built from its unmodified [source](https://ffmpeg.org/releases/) without its GPL parts) and [QuickJS](https://bellard.org/quickjs/) (MIT). About, in Settings, lists them with their versions, beside the packages Bandmate is built from, and their license texts are in the image's `/usr/local/share/licenses/`.
