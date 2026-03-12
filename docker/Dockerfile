# ---------deps-----------
FROM node:24-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./


RUN pnpm install --frozen-lockfile


# ---------builder-----------
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules

COPY prisma ./prisma
COPY prisma.config.ts ./

# Dummy value — Prisma only needs it to exist (won't connect)
ENV DATABASE_URL="postgresql://dummy:dummy@127.0.0.1:5432/dummy?schema=public"

RUN npx prisma generate

COPY . .

RUN pnpm run build


# ---------runner-----------
FROM node:24-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

# Install OpenSSL (required for Prisma client)
RUN apk add --no-cache openssl

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/prisma.config.ts ./

# Ensure Prisma client is properly linked
RUN npx prisma generate --postinstall

USER nodejs

EXPOSE 3000

CMD ["node", "dist/src/main.js"]