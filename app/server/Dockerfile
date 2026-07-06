# Build context is the REPO ROOT (app/ui and app/server both visible).
# Stage 1: build the UI so no dist/ is needed on the host.
FROM node:22-slim AS ui-build
WORKDIR /build/ui
COPY app/ui/package.json app/ui/package-lock.json* ./
RUN npm install
COPY app/ui/ ./
# Cache-buster: pass --build-arg UI_REBUILD=$(date +%s) to force a fresh UI
# build — recreating containers alone never de-stales a baked-in UI.
ARG UI_REBUILD=0
RUN echo "UI build $UI_REBUILD" && npm run build

# Stage 2: the server, with the built UI baked in at /app/ui/dist.
FROM node:22-slim
WORKDIR /app/server
COPY app/server/package.json app/server/package-lock.json* ./
RUN npm install --omit=dev
COPY app/server/src ./src
COPY app/server/tsconfig.json ./
COPY --from=ui-build /build/ui/dist /app/ui/dist
EXPOSE 8321
CMD ["npx", "tsx", "src/index.ts"]
