# ---------deps-----------
FROM node:24-alpine AS deps
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------builder-----------
FROM node:24-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN pnpm run build
# 
RUN pnpm prune --prod

# ------runner----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.js ./

EXPOSE 3000
CMD ["node", "dist/src/main.js"]