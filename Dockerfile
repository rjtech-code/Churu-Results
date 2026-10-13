# Production image: builds frontend + backend, runs as non-root.
# tsx is installed with --no-save at the exact version in backend/package-lock.json, because
# migrations and CLI scripts (backend/scripts) run through tsx.
FROM node:24-slim AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm --prefix backend ci && npm --prefix frontend ci
COPY backend backend
COPY frontend frontend
RUN npm --prefix frontend run build && npm --prefix backend run build

FROM node:24-slim AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN TSX_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/tsx'].version")" \
    && npm ci --omit=dev \
    && npm install --no-save "tsx@${TSX_VERSION}"

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=deps --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/dist ./dist
COPY --chown=node:node backend/package.json backend/tsconfig.json ./
COPY --chown=node:node backend/src ./src
COPY --chown=node:node backend/scripts ./scripts
COPY --from=build --chown=node:node /app/frontend/dist /app/frontend/dist
COPY --chown=node:node docs /app/docs
RUN mkdir -p reports && chown node:node reports
USER node
EXPOSE 3100
CMD ["node", "dist/server.js"]
