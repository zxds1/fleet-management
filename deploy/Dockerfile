# =============================================================================
# deploy/Dockerfile - single image, two roles (api / worker)
# Targets:
#   dev   : source mounted, ts-node watch (used by docker-compose)
#   prod  : compiled dist (used by k8s)
# =============================================================================

FROM node:20-bookworm AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

FROM base AS prod-build
RUN npm run build

FROM base AS dev
EXPOSE 4000 8082
CMD ["npm", "run", "dev:api"]

FROM prod-build AS prod
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/api/server.js"]
