# Build the TS bundle (dist/stbPlayer.js)
FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json build-concat.cjs vite.config.ts ./
COPY src ./src
RUN npm ci --ignore-scripts && npm run typecheck && npm run build

# Serve static player + EPG/logo proxy endpoints via the bundled python server
FROM python:3.14-alpine@sha256:3f818d6811ff5f3f2b5e5d836df3d25c2dd2e588d3b4981338a8ba17e422f74f
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY index.html favicon.ico server.py ./
COPY fonts ./fonts
# Local library fallbacks (index.html loads /js/* when the CDN is unreachable,
# e.g. LAN-only STB deployments) — must ship in the image.
COPY js ./js
COPY stb ./stb
COPY stbPlayer ./stbPlayer
COPY prov ./prov
EXPOSE 8080
# --no-epg: skip the 53MB default EPG download at startup; pass real sources via --epg-url
CMD ["python3", "server.py", "8080", "--no-epg"]
