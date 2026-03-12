# ---------deps-----------
FROM node:24-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile


# ---------builder-----------
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ── This is the important line ────────────────────────────────
# Dummy value — Prisma only needs it to exist (won't connect)
ENV DATABASE_URL="postgresql://dummy:dummy@127.0.0.1:5432/dummy?schema=public"

RUN npx prisma generate

RUN pnpm run build


# ---------runner-----------
FROM node:24-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

# Important: do NOT set DATABASE_URL here — let your deployment platform (Railway, Render, Fly, K8s, etc.) inject the real one
# If you accidentally set a dummy here it will break runtime!

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

# If you have a .env file or other config you want at runtime — copy it here (but usually better to use platform env vars)

EXPOSE 3000

CMD ["node", "dist/main.js"]