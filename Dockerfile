# Build stage
FROM node:20-slim AS build

ARG VITE_KEYCLOAK_URL
ARG VITE_KEYCLOAK_REALM
ARG VITE_KEYCLOAK_CLIENT_ID
# VITE_GRIST_DOC_ID is not a secret (a Grist document id, not a key) — but it must
# still go through a build ARG: since .dockerignore excludes .env (review lot 12,
# 2026-09-17, to avoid leaking VITE_GRIST_API_KEY/LDAP_BIND_PASSWORD into the Docker
# layers), vite.config.ts::loadEnv() no longer finds that file in the build context
# and compiles the bundle with VITE_GRIST_DOC_ID undefined (2026-09-18 incident: Grist proxy
# called on /api/grist/docs/undefined/... in a loop, no data loaded at all).
ARG VITE_GRIST_DOC_ID

ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
ENV VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM
ENV VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID
ENV VITE_GRIST_DOC_ID=$VITE_GRIST_DOC_ID

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-slim

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
# Help centre pages: source of the « Aide Druid » assistant (/api/help-chat, HELP_DOCS_DIR).
COPY --from=build /app/help/src/content/docs ./help/src/content/docs

EXPOSE 3000
CMD ["node", "server.cjs"]
