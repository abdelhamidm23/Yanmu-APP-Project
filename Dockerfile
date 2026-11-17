# Development image: runs migrations, creates test accounts, then the dev server.
# Production packaging (docker-compose.prod.yml, Caddy, worker) arrives in Phase 8.
FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:migrate && pnpm seed:dev-users && pnpm dev"]
