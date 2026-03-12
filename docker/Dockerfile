# ---------deps-----------
FROM node:24-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy minimal files for install + generate
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN pnpm install --frozen-lockfile


# ---------builder-----------
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules

# Copy Prisma config & schema first
COPY prisma ./prisma
COPY prisma.config.ts ./

# Dummy for generate (Prisma 7 requires it even if not connecting)
ENV DATABASE_URL="postgresql://dummy:dummy@127.0.0.1:5432/dummy?schema=public"

# Generate EARLY — this creates TS files that tsc needs to compile properly
RUN npx prisma generate

# Now bring in the rest of the code
COPY . .

# Build — generated client is now present for tsc to resolve everything
RUN pnpm run build


# ---------runner-----------
FROM node:24-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

# Optional: Explicitly copy the generated Prisma client folder if symlinks break
# COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000

CMD ["node", "dist/src/main.js"]