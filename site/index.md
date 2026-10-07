---
layout: home

hero:
  name: Bandmate
  text: A songwriting notebook you host yourself
  tagline: Write songs with chords. Record takes over your beats. Keep every version of a song in one place.
  image:
    src: /favicon.svg
    alt: "Bandmate's mark: a guitar pick with a flat cut out of it"
  actions:
    - theme: brand
      text: Get started
      link: /self-hosting
    - theme: alt
      text: Take the tour
      link: /features
    - theme: alt
      text: View on GitHub
      link: https://github.com/xKirtle/bandmate

features:
  - title: Write
    details: Write lyrics with the chords right where you play them. Try a few versions of a verse, and keep the lines that didn't make it.
    link: /features#write
  - title: Listen
    details: Lay out your beats on a multi-track timeline. Upload a beat, or download one from YouTube, SoundCloud or Bandcamp.
    link: /features#listen
  - title: Sync
    details: Tap along to mark when each line starts, and the lyrics light up and scroll as the song plays.
    link: /features#sync
  - title: Record
    details: Sing over your beat in the browser, in full quality, and keep every take until you pick one.
    link: /features#record
---

<img src="@screenshots/write-mode.png" alt="A Song in Write mode: its Details, the Lyric Sheet with Chords and Cues, the Scrapbook, and the Timeline with a Beat and a Take">

## Why Bandmate

Writing a song often means lyrics in a notes app, chords somewhere else, the beat in a browser tab and voice memos scattered across a phone. Bandmate puts them on one page: your lyrics and chords beside a timeline holding the beat and your takes, with each line marked at the moment it's sung.

It's built for one songwriter, and runs on your own machine or homelab. There are no accounts and no subscription, and your Songs stay on your server.

## Try it

```sh
mkdir data
docker run -d --name bandmate --restart unless-stopped \
  --user "$(id -u):$(id -g)" -p 8080:8080 -v "$PWD/data:/data" \
  ghcr.io/xkirtle/bandmate:latest
```

Then open http://localhost:8080. Bandmate has no login, so before using it anywhere beyond your own machine, read [Security](/self-hosting#security).
