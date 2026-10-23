# =============================================================================
# deploy/Dockerfile - single image, two roles (api / worker)
# Targets:
#   dev   : source mounted, ts-node watch (used by docker-compose)
#   prod  : compiled dist (used by k8s)
#
# Each workspace package compiles to packages/<name>/dist, because every
# package tsconfig sets `outDir` relative to the package. There is NO root-level
# dist/, so the runtime entrypoints are packages/api/dist/server.js and
# packages/worker/dist/index.js.
# =============================================================================

FROM node:20-bookworm AS base
WORKDIR /app
# Upgrade the base image packages so the build starts from patched versions
# (bookworm security updates live in a separate suite).
RUN echo "deb http://security.debian.org/debian-security bookworm-security main" > /etc/apt/sources.list.d/bookworm-security.list && \
    apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Every workspace's package.json must exist BEFORE `npm ci`: with the workspaces
# glob only matching existing packages, a missing packages/*/package.json makes
# npm install just the root's own deps and `npm run build` then fails with
# TS2307 on every external (zod, @sentry/node, ...).
COPY packages/api/package.json     ./packages/api/package.json
COPY packages/shared/package.json  ./packages/shared/package.json
COPY packages/db/package.json      ./packages/db/package.json
COPY packages/worker/package.json  ./packages/worker/package.json
COPY packages/ws/package.json      ./packages/ws/package.json
RUN npm ci
COPY . .

FROM base AS prod-build
RUN npm run build

FROM base AS dev
EXPOSE 4000 8082
CMD ["npm", "run", "dev:api"]

# Production dependency tree: workspace packages only, no devDependencies, and
# without the root package's own dependencies (build tooling only at the root).
FROM node:20-bookworm-slim AS prod-deps
ENV NODE_ENV=development
WORKDIR /app
# bookworm security updates live in a separate suite; add it so apt-get
# upgrade lands patched versions of OS packages (libgnutls30, libcap2, ...).
RUN echo "deb http://security.debian.org/debian-security bookworm-security main" > /etc/apt/sources.list.d/bookworm-security.list && \
    apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/api/package.json     ./packages/api/package.json
COPY packages/shared/package.json  ./packages/shared/package.json
COPY packages/db/package.json      ./packages/db/package.json
COPY packages/worker/package.json  ./packages/worker/package.json
COPY packages/ws/package.json      ./packages/ws/package.json
RUN NODE_ENV=development npm ci && \
    npm cache clean --force

FROM node:20-bookworm-slim AS prod
ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app
# postgresql-client is the psql binary used by the schema-migration Job.
# bookworm-security (see prod-deps) so installed OS packages carry the latest
# security patches before trivy scans the image.
RUN echo "deb http://security.debian.org/debian-security bookworm-security main" > /etc/apt/sources.list.d/bookworm-security.list && \
    apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends && \
    apt-get install -y --no-install-recommends postgresql-client && \
    rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-build /app/packages/api/dist    ./packages/api/dist
COPY --from=prod-build /app/packages/shared/dist ./packages/shared/dist
COPY --from=prod-build /app/packages/db/dist     ./packages/db/dist
COPY --from=prod-build /app/packages/worker/dist ./packages/worker/dist
COPY --from=prod-build /app/packages/ws/dist     ./packages/ws/dist
COPY db/schema ./db/schema
COPY db/seed ./db/seed
COPY db/migrate.sh ./db/migrate.sh
RUN chmod +x ./db/migrate.sh && chown -R node:node /app
USER node
EXPOSE 4000
# The image serves the API on $PORT and the worker on $HEALTH_PORT; both answer
# GET /healthz, so the probe target is selected with the environment.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const p=+(process.env.HEALTHCHECK_PORT||process.env.PORT||4000);const u=process.env.HEALTHCHECK_PATH||'/healthz';require('http').get({host:'127.0.0.1',port:p,path:u,timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "packages/api/dist/server.js"]
