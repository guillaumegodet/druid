# Build stage
FROM node:24-slim AS build

# No instance setting is compiled into the bundle: the front receives its Grist doc and settings
# from /api/me at runtime (lib/instanceRuntime.ts), so the same image serves the test and the
# production instances (druid-internal/docs/plan-separation-test-prod-rssi.md, lot 1). Only the
# build identity comes in: the commit (the .git folder is not in the build context) and the date,
# read by scripts/build-info.cjs. Add a `-dirty` suffix to GIT_SHA for a build from uncommitted changes.
ARG GIT_SHA=""
ARG BUILD_DATE=""
ENV GIT_SHA=$GIT_SHA
ENV BUILD_DATE=$BUILD_DATE

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:24-slim

# Image metadata (OCI): `docker inspect` tells which release a container runs.
ARG GIT_SHA=""
ARG BUILD_DATE=""
ARG DRUID_VERSION=""
LABEL org.opencontainers.image.title="Druid" \
      org.opencontainers.image.source="https://github.com/guillaumegodet/druid" \
      org.opencontainers.image.licenses="CECILL-2.1" \
      org.opencontainers.image.version="$DRUID_VERSION" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.created="$BUILD_DATE"

# python3 (stdlib only) required by scripts/structures-viz/visualize_structures.py
# (structures hierarchy dataviz — endpoint /api/structures-hierarchy.html)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/server.cjs ./server.cjs
# Build identity written by `npm run build` (version shown by /api/me and the top bar).
COPY --from=build /app/build-info.json ./build-info.json
# Help centre pages: source of the « Aide Druid » assistant (/api/help-chat, HELP_DOCS_DIR).
COPY --from=build /app/help/src/content/docs ./help/src/content/docs

EXPOSE 3000
# Liveness: /api/health answers without session (node:20-slim has no curl).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.cjs"]
