# syntax=docker/dockerfile:1

# The programs adding a Beat from a link runs (ADR 0016): yt-dlp fetches,
# ffmpeg keeps every fetched Beat an m4a, and QuickJS solves YouTube's
# challenges for yt-dlp. Each is pinned to a version and checksum, and built
# or downloaded for the same Debian as the runtime image, so the glibc they
# link against is there. Their versions are also recorded in programs.json,
# for the About page.
ARG YT_DLP_VERSION=2026.08.19
ARG FFMPEG_VERSION=8.1.3
ARG QUICKJS_VERSION=2026-06-04

# Build the Svelte SPA.
FROM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Build the Go binary with the SPA embedded. Pure Go SQLite, so no cgo.
FROM golang:1.27-alpine AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./web/dist
# Which build this is, shown on the About page: the release tag (tag builds
# only), the commit, and the repository it came from. CI passes them; a
# build without them shows "dev" and links to the upstream repository.
ARG VERSION=""
ARG REVISION=""
ARG SOURCE_URL=""
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w \
      -X github.com/xKirtle/bandmate/internal/build.version=${VERSION} \
      -X github.com/xKirtle/bandmate/internal/build.revision=${REVISION} \
      -X github.com/xKirtle/bandmate/internal/build.sourceURL=${SOURCE_URL}" \
      -o /out/bandmate ./cmd/bandmate \
 && mkdir -p /out/data

# yt-dlp's standalone Linux build, which bundles its own Python. A weekly CI
# job (.github/workflows/yt-dlp.yml) opens a pull request bumping these when
# yt-dlp releases.
FROM debian:trixie-slim AS yt-dlp
ARG TARGETARCH
ARG YT_DLP_VERSION
ARG YT_DLP_SHA256_AMD64=58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a
ARG YT_DLP_SHA256_ARM64=b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      amd64) asset=yt-dlp_linux sum=$YT_DLP_SHA256_AMD64 ;; \
      arm64) asset=yt-dlp_linux_aarch64 sum=$YT_DLP_SHA256_ARM64 ;; \
      *) echo "yt-dlp has no standalone build for $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${asset}" \
 && echo "$sum  /yt-dlp" | sha256sum -c - \
 && chmod 0755 /yt-dlp

# ffmpeg, built from source with only what a fetched Beat needs: it demuxes
# whatever yt-dlp fetches, decodes its audio and encodes AAC. No GPL or
# nonfree parts, so it's LGPL, and without the video codecs it stays small.
FROM debian:trixie-slim AS ffmpeg
ARG FFMPEG_VERSION
ARG FFMPEG_SHA256=7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils build-essential nasm pkgconf \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL -o ffmpeg.tar.xz "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
 && echo "$FFMPEG_SHA256  ffmpeg.tar.xz" | sha256sum -c - \
 && tar -xJf ffmpeg.tar.xz --strip-components=1 \
 && ./configure \
      --disable-autodetect --disable-debug --disable-doc --disable-ffplay \
      --disable-avdevice --disable-swscale \
      --disable-encoders --enable-encoder=aac,pcm_s16le \
      --disable-decoders \
      --enable-decoder='aac,aac_fixed,aac_latm,alac,flac,mp1*,mp2*,mp3*,opus,vorbis,ac3*,eac3*,dca,truehd,wma*,pcm_*,adpcm_*,amr*,ape,wavpack,tta,mjpeg,png' \
 && make -j"$(nproc)" ffmpeg ffprobe \
 && strip ffmpeg ffprobe

# QuickJS, built from source, as Bellard publishes binaries for x86_64 only.
FROM debian:trixie-slim AS quickjs
ARG QUICKJS_VERSION
ARG QUICKJS_SHA256=b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils build-essential \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL -o quickjs.tar.xz "https://bellard.org/quickjs/quickjs-${QUICKJS_VERSION}.tar.xz" \
 && echo "$QUICKJS_SHA256  quickjs.tar.xz" | sha256sum -c - \
 && tar -xJf quickjs.tar.xz --strip-components=1 \
 && make -j"$(nproc)" qjs \
 && strip qjs

# What the About page lists among Bandmate's dependencies: each bundled
# program, its version and its license (SPDX).
FROM debian:trixie-slim AS programs
ARG YT_DLP_VERSION
ARG FFMPEG_VERSION
ARG QUICKJS_VERSION
RUN printf '[\n  {"name": "yt-dlp", "version": "%s", "license": "Unlicense"},\n  {"name": "ffmpeg", "version": "%s", "license": "LGPL-2.1-or-later"},\n  {"name": "QuickJS", "version": "%s", "license": "MIT"}\n]\n' \
      "$YT_DLP_VERSION" "$FFMPEG_VERSION" "$QUICKJS_VERSION" > /programs.json

# The runtime image: the binary and the programs it runs. distroless/cc has
# the glibc they need.
FROM gcr.io/distroless/cc-debian13:nonroot
COPY --from=yt-dlp /yt-dlp /usr/local/bin/yt-dlp
COPY --from=ffmpeg /src/ffmpeg /src/ffprobe /usr/local/bin/
COPY --from=quickjs /src/qjs /usr/local/bin/qjs
COPY --from=programs /programs.json /usr/local/share/bandmate/programs.json
COPY --from=server /out/bandmate /bandmate
# Writable by the nonroot user when no bind mount replaces it.
COPY --from=server --chown=nonroot:nonroot /out/data /data
ENV BANDMATE_ADDR=:8080 \
    BANDMATE_DATA_DIR=/data
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/bandmate", "healthcheck"]
ENTRYPOINT ["/bandmate"]
