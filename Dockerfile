# =============================================================================
# Democratic Decay Monitor - Multi-stage Docker Build
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies (all workspaces)
# -----------------------------------------------------------------------------
FROM oven/bun:1.2 AS deps

WORKDIR /app

# Copy root package files + workspaces
COPY package.json bun.lockb* ./
COPY server/ ./server/
COPY scripts/ ./scripts/

# Install all dependencies (resolves workspaces)
RUN bun install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: Build Server
# -----------------------------------------------------------------------------
FROM oven/bun:1.2 AS server-builder

WORKDIR /app

# Copy dependencies from deps stage (hoisted to root in Bun workspaces)
COPY --from=deps /app/node_modules ./node_modules

# Copy server source
COPY server/ ./server/

WORKDIR /app/server

# Build server (compile TypeScript)
RUN bun run build

# -----------------------------------------------------------------------------
# Stage 3: Build Frontend
# -----------------------------------------------------------------------------
FROM oven/bun:1.2 AS frontend-builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy frontend source (root level files)
COPY package.json ./
COPY bun.lockb* ./
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY tsconfig.app.json ./
COPY tsconfig.node.json ./
COPY src/ ./src/
COPY index.html ./

WORKDIR /app

# Build frontend (using root package.json scripts)
RUN bun run build

# -----------------------------------------------------------------------------
# Stage 4: Production Server
# -----------------------------------------------------------------------------
FROM oven/bun:1.2 AS production

WORKDIR /app

# Copy server from builder
COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/package.json ./package.json

# Copy frontend build
COPY --from=frontend-builder /app/dist ./frontend/dist

# Create data directory and ensure it's writable
RUN mkdir -p /app/data && chmod 777 /app/data

# Environment variables (set at runtime)
ENV NODE_ENV=production
ENV PORT=3000
# Use absolute path for SQLite database
ENV DATABASE_URL=file:///app/data/democracy.db

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health/live || exit 1

# Start server
CMD ["bun", "run", "dist/index.js"]
