# Build the TS bundle (dist/stbPlayer.js)
FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json build-concat.cjs ./
COPY src ./src
RUN npm ci --ignore-scripts && npm run typecheck && npm run build

# Serve static player + EPG/logo proxy endpoints via the bundled python server
FROM python:3.14-alpine@sha256:05b2b8b732ecd268fee8727a369f936f022d1321b59befd13c30ede22769dcdc
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY index.html favicon.ico server.py ./
COPY fonts ./fonts
COPY stb ./stb
COPY stbPlayer ./stbPlayer
COPY prov ./prov
EXPOSE 8080
# --no-epg: skip the 53MB default EPG download at startup; pass real sources via --epg-url
CMD ["python3", "server.py", "8080", "--no-epg"]
