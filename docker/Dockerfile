# ---------deps-----------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN pnpm ci

# ---------builder-----------
FROM node:24-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY prisma ./prisma

RUN npx prisma generate

COPY . .
RUN pnpm run build

# ------runner----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
CMD ["node", "dist/main.js"]
