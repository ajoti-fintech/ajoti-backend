# ---------deps-----------
FROM node:24-alpine AS deps
WORKDIR /app
# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package*.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------builder-----------
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate Prisma client for Neon
RUN npx prisma generate
RUN pnpm run build

# ---------runner-----------
FROM node:24-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

EXPOSE 3000

# This runs migrations against Neon, then starts the API
CMD pnpm prisma migrate deploy && node dist/main.js