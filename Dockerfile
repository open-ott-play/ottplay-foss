# Build the TS bundle (dist/stbPlayer.js)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json build-concat.cjs ./
COPY src ./src
RUN npm ci --ignore-scripts && npm run typecheck && npm run build

# Serve static player + EPG/logo proxy endpoints via the bundled python server
FROM python:3.12-alpine
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
