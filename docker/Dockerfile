# ---------stage: deps-----------
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
RUN echo "public-hoist-pattern[]=*prisma*" > .npmrc
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------builder-----------
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.npmrc ./.npmrc
COPY package.json pnpm-lock.yaml ./
COPY . .
# prisma generate only reads schema.prisma — never connects to the DB.
# Placeholder satisfies prisma.config.ts env() call at load time.
ENV DATABASE_URL=postgresql://placeholder:5432/placeholder
RUN pnpm prisma generate
RUN pnpm run build

# ---------runner----------
FROM node:24-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

# No network calls here — everything copied from previous stages
COPY --from=deps /app/node_modules ./node_modules
# .prisma = query engine, @prisma/engines = schema-engine needed for migrate deploy
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/src/main.js"]