FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Runtime dependencies for the background build worker (workers/build-job.mjs).
# The worker is a raw ESM file that Next.js does NOT trace, so exceljs (and its
# transitive deps) would otherwise be absent from the standalone image and the
# worker would crash on startup. Install exceljs into an isolated tree that we
# drop next to the worker, so it resolves without touching the server's deps.
FROM node:22-alpine AS worker-deps
WORKDIR /worker-deps
RUN npm init -y >/dev/null 2>&1 && npm install --omit=dev --no-audit --no-fund exceljs@4.4.0

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATA_DIR=/data
ENV BUILD_WORKER_PATH=/app/workers/build-job.mjs
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs && mkdir -p /data && chown nextjs:nodejs /data
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/workers ./workers
COPY --from=builder --chown=nextjs:nodejs /app/lib/lcr2.ts ./lib/lcr2.ts
# exceljs resolves from /app/workers/node_modules for the worker only.
COPY --from=worker-deps --chown=nextjs:nodejs /worker-deps/node_modules ./workers/node_modules
USER nextjs
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
