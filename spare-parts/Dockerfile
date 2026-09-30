# ARACO Spare Parts — single deployable image (API + web app + PDF engine + backup tools)
#
# Fast rebuilds: the base image is pinned by digest, so Docker never swaps it for a newer
# upload of the same tag (that made every layer, including the ~1 hour system install, rebuild).
# To move to a newer Node base image on purpose, change NODE_IMAGE here (tag@sha256:digest).
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY apps apps
RUN npm run build -w apps/api && npm run build -w apps/web

# Production packages only; rebuilt only when package-lock.json changes
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=4100 STORAGE_DIR=../../storage CHROMIUM_PATH=/usr/bin/chromium PG_BIN_DIR=/usr/lib/postgresql/16/bin
# System packages (the slow step). Keep this command unchanged: Docker then reuses the layer it already built.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg chromium fonts-dejavu-core openssl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
# Generate the Prisma client for this image's platform (openssl 3); reruns only when the schema changes
RUN cd apps/api && npx prisma generate && mkdir -p /app/storage && chown -R node:node /app/storage
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY source-data source-data
USER node
WORKDIR /app/apps/api
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10m CMD node -e "fetch('http://localhost:'+(process.env.PORT||4100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply migrations, import the original workbook (skipped when already imported; also seeds
# roles/settings and the first admin), then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/import/cli.js && node dist/src/index.js"]
