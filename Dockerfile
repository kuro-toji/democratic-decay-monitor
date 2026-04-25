# =============================================================================
# Democratic Decay Monitor - Multi-stage Docker Build
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM oven/bun:1.2 AS deps

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install all dependencies
RUN bun install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: Build Server
# -----------------------------------------------------------------------------
FROM oven/bun:1.2 AS server-builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules

# Copy server source
COPY server/ ./server/

WORKDIR /app/server

# Build server (compile TypeScript)
RUN bun --no-bundlesrc run build

# -----------------------------------------------------------------------------
# Stage 3: Build Frontend
# -----------------------------------------------------------------------------
FROM oven/bun:1.2 AS frontend-builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/client/node_modules ./client/node_modules 2>/dev/null || true

# Copy frontend source
COPY client/ ./client/
COPY src/ ./src/
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY tsconfig.node.json ./

WORKDIR /app

# Build frontend
RUN bun run build

# -----------------------------------------------------------------------------
# Stage 4: Production Server
# -----------------------------------------------------------------------------
FROM oven/bun:1.2 AS production

# Install production dependencies only
RUN bun add --global drizzle-kit@latest

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy server from builder
COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/package.json ./package.json

# Copy frontend build
COPY --from=frontend-builder /app/dist ./frontend/dist

# Create data directory
RUN mkdir -p data && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Environment variables (set at runtime)
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=file:data/democracy.db

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health/live || exit 1

# Start server
CMD ["bun", "run", "dist/index.js"]
