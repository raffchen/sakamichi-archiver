FROM node:22-slim

# ffmpeg: poster/thumb generation at container startup (index build needs it).
# Nothing else is installed at build time — the image contains no data.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# dependency layer: cached unless the lockfile changes
COPY package.json package-lock.json ./
RUN npm ci

# source + build (devDependencies included — vite is needed for the build)
COPY . .
# index.json is deliberately NOT built here: the media volume doesn't exist at
# image build time. server.mjs builds the index on startup and re-indexes on
# change. (vite still copies the empty public/ into dist/ — harmless.)
RUN npx vite build

ENV PORT=8080 \
    MEDIA_DIR=/data/media

EXPOSE 8080
VOLUME ["/data/media"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
