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
    details: Lyrics in Sections, with Chords anchored anywhere in a Line. Alternates to weigh versions, and a Scrapbook for leftovers.
    link: /features#write
  - title: Listen
    details: A Timeline of Beats and Sounds, each Track with its own volume, mute and solo. Upload a Beat, or paste a link to one.
    link: /features#listen
  - title: Sync
    details: Cue each Line to the moment it's sung, and the Lyric Sheet follows along as the Timeline plays.
    link: /features#sync
  - title: Record
    details: Lossless Takes in the browser, over whatever the Timeline holds, with latency calibrated per device.
    link: /features#record
---

![A Song in Write mode: its Details, the Lyric Sheet with Chords and Cues, the Scrapbook, and the Timeline with a Beat and a Take](../docs/screenshots/write-mode.png)

## Why Bandmate

Writing a song often means lyrics in a notes app, chords somewhere else, the beat in a browser tab and voice memos scattered across a phone. Bandmate puts them on one page: the Lyric Sheet beside a Timeline holding the Beat and your Takes, with each Line cued to the moment it's sung.

It's built for one songwriter, and runs on your own machine or homelab. There are no accounts and no subscription, and your Songs stay on your server.

## Try it

```sh
mkdir data
docker run -d --name bandmate --restart unless-stopped \
  --user "$(id -u):$(id -g)" -p 8080:8080 -v "$PWD/data:/data" \
  ghcr.io/xkirtle/bandmate:latest
```

Then open http://localhost:8080. Bandmate has no login, so before using it anywhere beyond your own machine, read [Security](/self-hosting#security).
