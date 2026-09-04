# Build the TS bundle (dist/stbPlayer.js)
FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm ci --ignore-scripts && npm run typecheck && npm run build

# Build Rust server
FROM rust:1.98@sha256:620dbcd124499c59e2406d3741574b5c5838cf9eb9656f0c3a03948f79b02959 AS rust-build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src-rs ./src-rs
RUN cargo build --release --bin ottplay-server

# Serve static player + endpoints via the Rust server
FROM gcr.io/distroless/cc-debian12@sha256:e5d81ddde149641e2a9ba55be4545bc125c67de07508b03ba4c22e6eb0ded5aa
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=rust-build /app/target/release/ottplay-server ./ottplay-server
COPY index.html favicon.ico ./
COPY fonts ./fonts
COPY js ./js
COPY stb ./stb
COPY stbPlayer ./stbPlayer
COPY prov ./prov
EXPOSE 8080
CMD ["./ottplay-server", "--port", "8080"]
