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
RUN pnpm prisma generate
RUN pnpm run build

# ---------runner----------
FROM node:24-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

# No network calls here — everything copied from previous stages
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.js ./

EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/src/main.js"]