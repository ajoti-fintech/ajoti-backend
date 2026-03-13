# ---------stage: deps-----------
FROM node:24-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy config and dependency files first
COPY .npmrc package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Install all dependencies
RUN pnpm install --frozen-lockfile

# ---------stage: builder-----------
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set dummy URL for generation
ENV DATABASE_URL="postgresql://dummy:dummy@127.0.0.1:5432/dummy"

# Build NestJS
RUN npx prisma generate && pnpm run build

# ---------stage: runner-----------
FROM node:24-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

# 1. Copy config and lockfiles
COPY .npmrc package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# 2. Install production dependencies (scripts will run due to .npmrc)
RUN pnpm install --prod --frozen-lockfile

# 3. Generate the actual runtime client
ENV DATABASE_URL="postgresql://dummy:dummy@127.0.0.1:5432/dummy"
RUN npx prisma generate

# 4. Copy the compiled code
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/src/main.js"]