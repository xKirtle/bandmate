# syntax=docker/dockerfile:1

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

# Minimal runtime image: just the binary.
FROM gcr.io/distroless/static-debian13:nonroot
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
