# Self-hosting

Bandmate runs as a single Docker container. Everything it stores (Songs, audio, Covers and Backups) lives in one `data` folder that you mount into it.

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

### Health check

The Compose file checks Bandmate is healthy with `bandmate healthcheck`. For your own monitoring, `GET /api/health` returns `200 {"status":"ok"}` while Bandmate can reach its database.

## Configuration

Set these in a `.env` file next to `compose.yaml`. All are optional.

| Variable                 | Default    | What it does                                                                  |
| ------------------------ | ---------- | ----------------------------------------------------------------------------- |
| `BANDMATE_PORT`          | `8080`     | The port Bandmate is on, on your machine                                      |
| `BANDMATE_IMAGE`         | `…:latest` | Which version to run: see [Image tags](#image-tags)                           |
| `PUID` / `PGID`          | `1000`     | The user the container runs as. It must own `./data`                          |
| `BANDMATE_MAX_UPLOAD_MB` | `500`      | The largest audio file Bandmate takes, uploaded or downloaded, in megabytes   |
| `BANDMATE_UPDATE_CHECK`  | `on`       | `off` stops Bandmate checking GitHub for new versions of itself and of yt-dlp |
| `BANDMATE_ADD_FROM_LINK` | `on`       | `off` turns off [downloading Beats from links](#downloading-beats-from-links) |

Running Bandmate outside Docker? It also reads `BANDMATE_ADDR`, the address it listens on (`:8080`), and `BANDMATE_DATA_DIR`, where it keeps its data (`./data`; the image sets it to `/data`).

## Downloading Beats from links

Paste a link to a video or track on YouTube, SoundCloud, Bandcamp or [any other site yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md), and Bandmate downloads its audio as a Beat, with the credit filled in. It uses [yt-dlp](https://github.com/yt-dlp/yt-dlp), which comes with the image.

- It takes one video at a time: not playlists, channels or live streams.
- The audio is saved as m4a. The download stops if it goes over `BANDMATE_MAX_UPLOAD_MB`, or takes longer than 10 minutes.
- A download you don't add to the Beat Library is deleted after an hour, or when Bandmate restarts.
- **Behind a reverse proxy?** A download is one long request, so give the proxy a read timeout of a few minutes.

### Keeping yt-dlp up to date

Sites change, and when they do, yt-dlp can stop working with them until its next release fixes it. You don't need to wait for a new Bandmate: open **Settings → About**, and if a newer yt-dlp is out, press **Update** beside it. Bandmate always uses the newest yt-dlp it has, whether that's your update or the one a later Bandmate brings.

### Mounting your own yt-dlp

::: warning For advanced setups only
Most installs never need this: **Update**, above, keeps yt-dlp current.
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

## Security

Bandmate has **no login**: anyone who can reach it can read and change every Song. That's fine on your own machine. Anywhere else, put it behind a reverse proxy that adds HTTPS and authentication, and let only the proxy reach it.

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

**To upgrade**, first [copy the data folder](#backups), then:

```sh
docker compose pull && docker compose up -d
```

Bandmate updates its database by itself when it starts.

**To roll back**, run the older tag. If the newer version changed the database, put back the copy of the data folder you made before upgrading too: an older Bandmate can't undo a newer one's changes.

## Backups

**In the app**, open **Settings → Backups** to back up the Songs you choose, the Beat Library, or both. Download a Backup to keep it somewhere else. To restore, upload a Backup to this Bandmate or another one, and pick what to bring back. Where a Song or Beat is already there, you choose whether to replace it or keep both, and nothing else is touched. A Backup restores into the same Bandmate version or a newer one, never an older one.

**By copying the data folder**: stop Bandmate, so nothing is mid-write, and copy `data`. It holds everything: the database, audio, Covers and Backups. Do this before every upgrade, so you can roll back.

## Licenses

Bandmate is licensed under the [GNU Affero General Public License v3.0](https://github.com/xKirtle/bandmate/blob/main/LICENSE). If you run a modified Bandmate as a service that others use over a network, you must offer them its source code.

To download Beats from links, the image also includes three programs under their own licenses: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (The Unlicense), [ffmpeg](https://ffmpeg.org) (LGPL v2.1 or later, built from its unmodified [source](https://ffmpeg.org/releases/) without its GPL parts) and [QuickJS](https://bellard.org/quickjs/) (MIT). Settings → About lists them with their versions, and their license texts are in the image at `/usr/local/share/licenses/`.
