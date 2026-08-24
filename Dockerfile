# Build the TS bundle (dist/stbPlayer.js)
FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json build-concat.cjs ./
COPY src ./src
RUN npm ci --ignore-scripts && npm run typecheck && npm run build

# Serve static player + EPG/logo proxy endpoints via the bundled python server
FROM python:3.12-alpine@sha256:d09d15e60962ca365d1cd544a48773bac9d33f2fb1b00f2aa0deec78ade7dc31
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
