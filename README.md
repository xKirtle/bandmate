<img src="web/public/favicon.svg" alt="Bandmate's mark: a guitar pick with a flat cut out of it" width="96" height="96">

# Bandmate

**Write songs with chords. Record takes over your beats. Self-hosted.**

[![CI](https://github.com/xKirtle/bandmate/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/xKirtle/bandmate/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/xKirtle/bandmate)](https://github.com/xKirtle/bandmate/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/github/license/xKirtle/bandmate)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-xkirtle.github.io%2Fbandmate-b4432c)](https://xkirtle.github.io/bandmate/)

![A Song in Write mode: its Details, the Lyric Sheet with Chords and Cues, the Scrapbook, and the Timeline with a Beat and a Take](docs/screenshots/write-mode.png)

Writing a song often means lyrics in a notes app, chords somewhere else, the beat in a browser tab and voice memos scattered across a phone. Bandmate puts them on one page: your lyrics and chords beside a timeline holding the beat and your takes, with each line marked at the moment it's sung.

It's built for one songwriter, and runs on your own machine or homelab. There are no accounts and no subscription, and your Songs stay on your server.

## What it does

- **Write** lyrics with the chords right where you play them. Try a few versions of a verse, and keep the lines that didn't make it.
- **Listen** to your beats on a multi-track timeline. Upload a beat, or download one from YouTube, SoundCloud or Bandcamp.
- **Sync** your lyrics to the music: tap along to mark when each line starts, and they light up and scroll as the song plays.
- **Record** takes over your beat in the browser, in full quality, and keep every one until you pick one.

![Sync mode cueing a Section's Lines as the Timeline plays](docs/screenshots/sync-mode.webp)

<details>
<summary>More screenshots</summary>

![The Song list on desktop, with each Song's Status, key and BPM](docs/screenshots/song-list.png)

![A Song in Read mode, with the Line playing highlighted](docs/screenshots/read-mode.png)

<img src="docs/screenshots/phone-lyric-sheet.png" alt="A Song's Lyric Sheet on a phone" width="300">

</details>

Every feature is in the [tour](https://xkirtle.github.io/bandmate/features).

## Quickstart

```sh
mkdir data
docker run -d --name bandmate --restart unless-stopped \
  --user "$(id -u):$(id -g)" -p 8080:8080 -v "$PWD/data:/data" \
  ghcr.io/xkirtle/bandmate:latest
```

Then open http://localhost:8080. For Docker Compose, use the repo's [`compose.yaml`](compose.yaml) with `mkdir data && docker compose up -d`.

> [!WARNING]
> Bandmate has no login: anything that can reach it can read and change every Song. Anywhere beyond your own machine, put it behind a reverse proxy that handles HTTPS and authentication. Recording also needs HTTPS, or localhost, for the microphone.

Configuration, updating and the rest are in the [self-hosting guide](https://xkirtle.github.io/bandmate/self-hosting).

## Learn more

- [Documentation](https://xkirtle.github.io/bandmate/): the feature tour and the self-hosting guide
- [Glossary](GLOSSARY.md): the words Bandmate uses, in the code and the UI alike
- [Roadmap](docs/roadmap.md) and [release notes](https://github.com/xKirtle/bandmate/releases): what might come next, and what each version shipped
- [Contributing](CONTRIBUTING.md): reporting bugs, sharing ideas, and building Bandmate
- [Security policy](SECURITY.md): reporting a vulnerability

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified Bandmate as a service that others use over a network, you must offer them its source code. The image also bundles yt-dlp, ffmpeg and QuickJS under their own licenses, as the [self-hosting guide](https://xkirtle.github.io/bandmate/self-hosting#licenses) lists.
