# syntax=docker/dockerfile:1.7

FROM node:26.7.0-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
ARG SOURCE_URL=https://github.com/ill-yes/steam-bee
ENV VITE_SOURCE_URL=${SOURCE_URL}
COPY apps/server/tsconfig.json apps/server/tsconfig.json
COPY apps/server/src apps/server/src
COPY apps/web/index.html apps/web/index.html
COPY apps/web/tsconfig.json apps/web/vite.config.ts apps/web/
COPY apps/web/src apps/web/src
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY LICENSE NOTICE COMMERCIAL-LICENSE.md ./
RUN pnpm build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter @steam-bee/server deploy --prod --legacy /prod
RUN cp -R apps/web/dist /prod/public
RUN cp LICENSE NOTICE COMMERCIAL-LICENSE.md /prod/

FROM node:26.7.0-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS runtime
RUN rm -rf \
  /usr/local/lib/node_modules/npm \
  /usr/local/lib/node_modules/corepack \
  /opt/yarn-v1.22.22 \
  && rm -f \
  /usr/local/bin/npm \
  /usr/local/bin/npx \
  /usr/local/bin/corepack \
  /usr/local/bin/yarn \
  /usr/local/bin/yarnpkg
ARG VERSION=dev
ARG REVISION=unknown
ARG BUILD_DATE=unknown
ARG SOURCE_URL=https://github.com/ill-yes/steam-bee
LABEL org.opencontainers.image.title="SteamBee" \
  org.opencontainers.image.description="Self-hosted operations console for managing your own Steam accounts." \
  org.opencontainers.image.licenses="AGPL-3.0-or-later" \
  org.opencontainers.image.version="${VERSION}" \
  org.opencontainers.image.revision="${REVISION}" \
  org.opencontainers.image.created="${BUILD_DATE}" \
  org.opencontainers.image.source="${SOURCE_URL}"
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data
ENV BUILD_VERSION=${VERSION}
ENV BUILD_REVISION=${REVISION}
ENV BUILD_DATE=${BUILD_DATE}
WORKDIR /app
RUN groupadd --gid 10001 steambee \
  && useradd --uid 10001 --gid steambee --create-home --no-log-init --shell /usr/sbin/nologin steambee \
  && mkdir -p /data \
  && chown -R steambee:steambee /data /app
COPY --from=build --chown=steambee:steambee /prod ./
COPY --chmod=0755 docker/steam-bee-entrypoint.sh /usr/local/bin/steam-bee-entrypoint
USER 10001:10001
EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/steam-bee-entrypoint"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["/usr/local/bin/steam-bee-entrypoint", "--healthcheck", "node", "-e", "if(process.getuid?.()===0||process.getgid?.()===0)process.exit(1);fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
