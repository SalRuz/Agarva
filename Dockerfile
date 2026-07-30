# WebSocket game server for Agarwa (frontend is served by nginx separately)
FROM node:22-bookworm-slim

WORKDIR /app

# Install deps first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci

# App sources (shared physics + server)
COPY shared ./shared
COPY server ./server
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

# Bind is already 0.0.0.0 in server/index.ts; PORT from env
CMD ["npx", "tsx", "server/index.ts"]
