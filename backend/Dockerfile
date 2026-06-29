FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ARG PNPM_VERSION=10.14.0

COPY backend/package.json backend/pnpm-lock.yaml ./
RUN npm install -g pnpm@${PNPM_VERSION} && pnpm install --prod --frozen-lockfile

COPY backend/src ./src
COPY database/schema.sql /database/schema.sql

EXPOSE 4000

CMD ["pnpm", "run", "start"]
