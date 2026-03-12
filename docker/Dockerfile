# ---------stage: deps-----------
FROM node:24-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy minimal files for install
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
# Copy config if it's required for the generate step
COPY prisma.config.ts ./ 

RUN pnpm install --frozen-lockfile

# ---------stage: builder-----------
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Bring in the installed node_modules
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set a dummy URL so Prisma can generate the client without a DB connection
ENV DATABASE_URL="postgresql://dummy:dummy@127.0.0.1:5432/dummy"

# Generate the Prisma Client for the build step and then build NestJS
RUN npx prisma generate && pnpm run build

# ---------stage: runner-----------
FROM node:24-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

# 1. Copy only files needed for a clean production install
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# 2. Re-install ONLY production dependencies
# This creates a flat, non-symlinked node_modules structure
RUN pnpm install --prod --frozen-lockfile

# 3. Regenerate the client for the runner environment
ENV DATABASE_URL="postgresql://dummy:dummy@127.0.0.1:5432/dummy"
RUN npx prisma generate

# 4. Copy the compiled NestJS code from the builder
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Start the application
CMD ["node", "dist/src/main.js"]