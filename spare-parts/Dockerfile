# ARACO Spare Parts — single deployable image (API + web app + PDF engine + backup tools)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY apps apps
RUN npm run build -w apps/api && npm run build -w apps/web && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4100 STORAGE_DIR=../../storage CHROMIUM_PATH=/usr/bin/chromium PG_BIN_DIR=/usr/lib/postgresql/16/bin
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg chromium fonts-dejavu-core openssl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/web/dist apps/web/dist
COPY source-data source-data
COPY package.json ./
# Regenerate the Prisma client for this image's platform (openssl 3)
RUN cd apps/api && npx prisma generate && mkdir -p /app/storage && chown -R node:node /app/storage
USER node
WORKDIR /app/apps/api
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10m CMD node -e "fetch('http://localhost:'+(process.env.PORT||4100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply migrations, import the original workbook (skipped when already imported; also seeds
# roles/settings and the first admin), then start.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/import/cli.js && node dist/src/index.js"]
