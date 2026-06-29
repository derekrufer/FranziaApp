FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY backend/package.json backend/pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@11.0.7 --activate && pnpm install --prod --frozen-lockfile

COPY backend/src ./src
COPY database/schema.sql /database/schema.sql

EXPOSE 4000

CMD ["pnpm", "run", "start"]
