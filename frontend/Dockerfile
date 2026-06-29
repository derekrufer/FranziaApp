FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ARG PNPM_VERSION=10.14.0

COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN npm install -g pnpm@${PNPM_VERSION} && pnpm install --frozen-lockfile

COPY frontend/index.html ./
COPY frontend/src ./src

RUN pnpm run build

FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
