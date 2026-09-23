# Bussola — one image for the app, the standalone sync worker and migrations.
#
#   docker build -t bussola .
#   docker run -p 3000:3000 -v bussola-data:/app/data bussola          # app
#   docker run -e DATABASE_URL=... bussola npm run worker              # worker
#   docker run -e DATABASE_URL=... bussola npm run db:migrate          # migrate
#
# With no DATABASE_URL the app keeps PGlite data (and its generated secrets)
# under /app/data, so mount a volume there or lose them with the container.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/next.config.ts /app/tsconfig.json ./

RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3000

CMD ["npm", "start"]
