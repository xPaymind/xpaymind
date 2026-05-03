FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/evaluator/package.json packages/evaluator/
COPY packages/sdk/package.json packages/sdk/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod

FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build --filter @xpaymind/api

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 xpaymind
COPY --from=builder --chown=xpaymind:nodejs /app/apps/api/dist ./dist
COPY --from=deps --chown=xpaymind:nodejs /app/node_modules ./node_modules
USER xpaymind
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/index.js"]
