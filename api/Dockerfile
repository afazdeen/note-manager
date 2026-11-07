# syntax=docker/dockerfile:1

# ---- Build: compile a static Go binary ----
# Runs on the build machine's platform and cross-compiles for the target, which is
# much faster than emulating another CPU when building multi-arch images.
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
WORKDIR /src

# Download modules in their own layer, so they're cached until go.mod/go.sum change.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .
ARG TARGETOS TARGETARCH
# CGO off: a fully static binary that runs on an image with no C library.
# -trimpath and -s -w: no local paths or debug symbols, so the binary is smaller.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ---- Run: just the binary on a distroless base (no shell or package manager) ----
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /server

# The app listens on 127.0.0.1 by default, which is unreachable from outside a
# container. Listen on all interfaces here, and decide who can reach it when
# publishing the port (the README and compose.yaml publish on 127.0.0.1 only).
ENV HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080

USER nonroot:nonroot
ENTRYPOINT ["/server"]
