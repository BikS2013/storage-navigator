# syntax=docker/dockerfile:1
# Build context is the repository root (the shared CI template runs
# `docker build -f API/Dockerfile <repo-root>`), so all COPY paths are
# prefixed with API/.
FROM node:22-alpine AS build
WORKDIR /app
COPY API/package.json API/package-lock.json ./
RUN npm ci
COPY API/tsconfig.json ./
COPY API/src ./src
COPY API/openapi.yaml ./
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY API/package.json API/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/openapi.yaml ./
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
