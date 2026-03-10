# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY server/package*.json ./server/
COPY web/package*.json ./web/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
COPY web ./web

# Build backend and frontend
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files for production dependencies
COPY package*.json ./
COPY server/package*.json ./server/

# Install only production dependencies
RUN npm ci --workspace server --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist ./web/dist

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/detect', (r) => {process.exit(r.statusCode === 405 ? 0 : 1)})"

# Start server
CMD ["node", "server/dist/index.js"]
