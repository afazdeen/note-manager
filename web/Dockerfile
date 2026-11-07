# syntax=docker/dockerfile:1

# ---- Build: compile the React app into static files ----
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies in their own layer, so they're cached until the lockfile changes.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY . .
# Vite bakes the API URL into the bundle at build time, so it's a build argument,
# not a runtime setting. It's the address the *browser* uses to reach the API.
ARG VITE_API_BASE_URL=http://localhost:8080/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# ---- Run: serve the static files with nginx (no Node in the final image) ----
# The unprivileged variant runs as a non-root user and listens on 8080. The slim
# variant leaves out modules this app doesn't use (about 30 MB instead of 90 MB).
FROM nginxinc/nginx-unprivileged:stable-alpine-slim
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
