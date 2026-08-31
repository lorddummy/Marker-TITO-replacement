# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY src/package*.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Non-root user for security
RUN addgroup -S tito && adduser -S tito -G tito

WORKDIR /app

# Copy only production deps and source
COPY --from=build /app/node_modules ./node_modules
COPY src/ ./

# Data volume for SQLite persistence
RUN mkdir -p /data && chown tito:tito /data
VOLUME ["/data"]

USER tito

ENV DB_PATH=/data/tito.db \
    PORT=3000 \
    NODE_ENV=production \
    LOG_LEVEL=info

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "index.js"]
