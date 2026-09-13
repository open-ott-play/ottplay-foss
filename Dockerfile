# Build the TS bundle (dist/stbPlayer.js)
FROM node:26-alpine@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json vite.config.ts ./
COPY src ./src
# Vite validates and stages the actual ES5 assets, including the boot loader.
COPY scripts/classic-bundle.cjs ./scripts/classic-bundle.cjs
COPY scripts/android-distribution.cjs ./scripts/android-distribution.cjs
COPY scripts/html-scripts.cjs ./scripts/html-scripts.cjs
COPY scripts/check-es5.cjs ./scripts/check-es5.cjs
COPY scripts/native-runtime.cjs scripts/native-dev.cjs scripts/play-system-icons.cjs ./scripts/
COPY index.html favicon.ico ./
COPY fonts ./fonts
COPY js ./js
COPY stb ./stb
COPY stbPlayer ./stbPlayer
COPY prov ./prov
COPY src-tauri/pip ./src-tauri/pip
RUN npm ci --ignore-scripts && npm run typecheck && npm run build:server

# Build Rust server against musl so the published image does not need
# GLIBC_2.38+ (Hub :latest built on a newer glibc toolchain failed on
# Synology DSM Docker / x86_64). Alpine = musl host target by default.
FROM rust:1.98-alpine@sha256:1716b3aa042d735f4566d14dc54e8037de9d69556e2d5dd58131d93a613d173d AS rust-build
RUN apk add --no-cache musl-dev build-base
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY vendor ./vendor
COPY src-rs ./src-rs
# Workspace lists src-tauri (desktop shell). Server image only builds
# ottplay-server - drop that member so cargo does not need /app/src-tauri.
RUN sed -i 's/, "src-tauri"//' Cargo.toml \
 && cargo build --release --bin ottplay-server

# Musl runtime (no glibc). ca-certificates for outbound HTTPS (EPG / M3U).
FROM alpine:3.24@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
RUN apk add --no-cache ca-certificates \
 && adduser -D -H -u 65532 -g nonroot nonroot
WORKDIR /app
COPY --from=rust-build /app/target/release/ottplay-server ./ottplay-server
# Use the validated web root, including the runtime-only player image allowlist.
# Copying source trees here would reintroduce retired and private assets.
COPY --from=build /app/dist/index.html ./index.html
COPY --from=build /app/dist/favicon.ico ./favicon.ico
COPY --from=build /app/dist/dist ./dist
COPY --from=build /app/dist/fonts ./fonts
COPY --from=build /app/dist/js ./js
COPY --from=build /app/dist/stb ./stb
COPY --from=build /app/dist/stbPlayer ./stbPlayer
COPY --from=build /app/dist/prov ./prov
USER nonroot
EXPOSE 8080
CMD ["./ottplay-server", "--port", "8080"]
